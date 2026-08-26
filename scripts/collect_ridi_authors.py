#!/usr/bin/env python3
"""RIDI 작가 페이지에서 작가명을 순차적으로 수집합니다."""

from __future__ import annotations

import argparse
import gzip
import io
import json
import os
import random
import re
import signal
import stat
import sys
import tempfile
import threading
import time
import unicodedata
from dataclasses import dataclass
from datetime import datetime, timezone
from html.parser import HTMLParser
from pathlib import Path
from typing import Callable, Dict, Iterable, List, Optional, Sequence, Set, Tuple
from urllib.error import HTTPError, URLError
from urllib.parse import urlparse
from urllib.request import Request, urlopen

try:
    import fcntl
except ImportError:
    fcntl = None

try:
    import msvcrt
except ImportError:
    msvcrt = None


PROJECT_ROOT = Path(__file__).resolve().parent.parent
DEFAULT_CHECKLIST_PATH = PROJECT_ROOT / "author_checklist.txt"
DEFAULT_OUTPUT_PATH = PROJECT_ROOT / "author.json"
DEFAULT_LOCK_PATH = PROJECT_ROOT / ".author-collector.lock"
AUTHOR_URL_TEMPLATE = "https://ridibooks.com/author/{author_id}"
MIN_AUTHOR_ID = 1
MAX_AUTHOR_ID = 172_716
MIN_REQUEST_DELAY_SECONDS = 1.0
MAX_REQUEST_DELAY_SECONDS = 3.0
DEFAULT_TIMEOUT_SECONDS = 20.0
DEFAULT_MAX_CONSECUTIVE_FAILURES = 5
MAX_COMPRESSED_RESPONSE_BYTES = 2 * 1024 * 1024
MAX_HTML_RESPONSE_BYTES = 5 * 1024 * 1024
USER_AGENT = (
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
    "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36 "
    "BookManagerAuthorCollector/1.0"
)


class CollectorError(Exception):
    """복구 가능한 개별 수집 오류입니다."""


class StopCollectionError(CollectorError):
    """추가 트래픽을 막기 위해 전체 실행을 중단해야 하는 오류입니다."""


class ConfigurationError(Exception):
    """입력 파일이나 실행 옵션이 잘못된 경우입니다."""


@dataclass
class _TextCapture:
    target_classes: Set[str]
    open_tags: List[str]
    pieces: List[str]


class AuthorNameParser(HTMLParser):
    TARGET_CLASSES = {"lang_kor", "lang_other"}
    VOID_ELEMENTS = {
        "area", "base", "br", "col", "embed", "hr", "img", "input",
        "link", "meta", "param", "source", "track", "wbr",
    }
    SUPPRESSED_ELEMENTS = {"script", "style"}

    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self._captures: List[_TextCapture] = []
        self._suppressed_depth = 0
        self._values: Dict[str, List[str]] = {
            "lang_kor": [],
            "lang_other": [],
        }

    def handle_starttag(self, tag: str, attrs: List[Tuple[str, Optional[str]]]) -> None:
        normalized_tag = tag.lower()

        for capture in self._captures:
            if normalized_tag == "br":
                capture.pieces.append(" ")
            if normalized_tag not in self.VOID_ELEMENTS:
                capture.open_tags.append(normalized_tag)

        if normalized_tag in self.SUPPRESSED_ELEMENTS:
            self._suppressed_depth += 1
            return

        class_value = next((value for name, value in attrs if name.lower() == "class"), "") or ""
        class_tokens = set(class_value.split())
        target_classes = class_tokens & self.TARGET_CLASSES
        if target_classes and normalized_tag not in self.VOID_ELEMENTS:
            self._captures.append(_TextCapture(target_classes, [normalized_tag], []))

    def handle_startendtag(self, tag: str, attrs: List[Tuple[str, Optional[str]]]) -> None:
        if tag.lower() == "br":
            for capture in self._captures:
                capture.pieces.append(" ")

    def handle_endtag(self, tag: str) -> None:
        normalized_tag = tag.lower()
        if normalized_tag in self.VOID_ELEMENTS:
            return

        remaining_captures: List[_TextCapture] = []
        for capture in self._captures:
            matching_indexes = [
                index
                for index, open_tag in enumerate(capture.open_tags)
                if open_tag == normalized_tag
            ]
            if matching_indexes:
                del capture.open_tags[matching_indexes[-1]:]

            if not capture.open_tags:
                value = normalize_scraped_name("".join(capture.pieces))
                if value:
                    for target_class in capture.target_classes:
                        self._values[target_class].append(value)
            else:
                remaining_captures.append(capture)
        self._captures = remaining_captures

        if normalized_tag in self.SUPPRESSED_ELEMENTS and self._suppressed_depth > 0:
            self._suppressed_depth -= 1

    def handle_data(self, data: str) -> None:
        if self._suppressed_depth > 0:
            return
        for capture in self._captures:
            capture.pieces.append(data)

    def get_names(self) -> List[str]:
        names: List[str] = []
        seen_keys: Set[str] = set()
        for target_class in ("lang_kor", "lang_other"):
            for value in self._values[target_class]:
                key = get_name_comparison_key(value)
                if key and key not in seen_keys:
                    seen_keys.add(key)
                    names.append(value)
        return names


def normalize_scraped_name(value: str) -> str:
    normalized = unicodedata.normalize("NFC", value or "")
    return re.sub(r"\s+", " ", normalized).strip()


def get_name_comparison_key(value: str) -> str:
    normalized = unicodedata.normalize("NFKC", value or "")
    return re.sub(r"\s+", " ", normalized).strip().casefold()


def extract_author_names(html_text: str) -> List[str]:
    parser = AuthorNameParser()
    parser.feed(html_text)
    parser.close()
    return parser.get_names()


def _get_header_value(headers: object, name: str) -> str:
    getter = getattr(headers, "get", None)
    if not callable(getter):
        return ""
    return str(getter(name, "") or "")


def _decode_response_body(response: object) -> str:
    compressed_body = response.read(MAX_COMPRESSED_RESPONSE_BYTES + 1)
    if len(compressed_body) > MAX_COMPRESSED_RESPONSE_BYTES:
        raise CollectorError("응답 압축 크기가 제한을 초과했습니다.")

    content_encoding = _get_header_value(response.headers, "Content-Encoding").lower()
    if content_encoding == "gzip":
        with gzip.GzipFile(fileobj=io.BytesIO(compressed_body)) as gzip_file:
            body = gzip_file.read(MAX_HTML_RESPONSE_BYTES + 1)
    else:
        body = compressed_body

    if len(body) > MAX_HTML_RESPONSE_BYTES:
        raise CollectorError("HTML 응답 크기가 제한을 초과했습니다.")

    charset = "utf-8"
    get_content_charset = getattr(response.headers, "get_content_charset", None)
    if callable(get_content_charset):
        charset = get_content_charset() or charset

    encodings = [charset]
    if charset.casefold().replace("_", "-") != "utf-8":
        encodings.append("utf-8")

    for encoding in encodings:
        try:
            return body.decode(encoding)
        except (LookupError, UnicodeDecodeError):
            continue
    raise CollectorError("HTML 문자 인코딩을 해석할 수 없습니다.")


def fetch_author_names(
    author_id: int,
    timeout_seconds: float = DEFAULT_TIMEOUT_SECONDS,
    opener: Callable[..., object] = urlopen,
) -> List[str]:
    url = AUTHOR_URL_TEMPLATE.format(author_id=author_id)
    request = Request(
        url,
        headers={
            "Accept": "text/html,application/xhtml+xml",
            "Accept-Encoding": "gzip",
            "Accept-Language": "ko-KR,ko;q=0.9,en;q=0.7",
            "User-Agent": USER_AGENT,
        },
    )

    try:
        response_context = opener(request, timeout=timeout_seconds)
        with response_context as response:
            response_status = getattr(response, "status", None)
            status_code = int(response_status if response_status is not None else response.getcode())
            final_url = str(response.geturl())
            content_type = _get_header_value(response.headers, "Content-Type").lower()
            retry_after = _get_header_value(response.headers, "Retry-After")
            retry_message = f", Retry-After={retry_after}" if retry_after else ""

            if status_code in {401, 403, 429, 503} or retry_after:
                raise StopCollectionError(f"HTTP {status_code}{retry_message}")
            if status_code < 200 or status_code >= 300:
                raise CollectorError(f"HTTP {status_code}")
            if content_type and "text/html" not in content_type:
                raise CollectorError(f"HTML이 아닌 응답입니다: {content_type}")

            parsed_url = urlparse(final_url)
            expected_path = f"/author/{author_id}"
            if parsed_url.scheme != "https":
                raise StopCollectionError(f"HTTPS가 아닌 주소로 이동했습니다: {final_url}")
            if parsed_url.hostname not in {"ridibooks.com", "www.ridibooks.com"}:
                raise StopCollectionError(f"허용되지 않은 주소로 이동했습니다: {final_url}")
            if parsed_url.path.rstrip("/") != expected_path:
                raise CollectorError(f"예상하지 않은 페이지로 이동했습니다: {final_url}")

            html_text = _decode_response_body(response)
    except HTTPError as error:
        retry_after = _get_header_value(error.headers, "Retry-After")
        retry_message = f", Retry-After={retry_after}" if retry_after else ""
        error.close()
        if error.code in {401, 403, 429, 503} or retry_after:
            raise StopCollectionError(f"HTTP {error.code}{retry_message}") from error
        raise CollectorError(f"HTTP {error.code}{retry_message}") from error
    except (TimeoutError, URLError, OSError) as error:
        raise CollectorError(f"네트워크 오류: {error}") from error

    names = extract_author_names(html_text)
    if not names:
        raise CollectorError(".lang_kor 또는 .lang_other 값을 찾지 못했습니다.")
    return names


def load_checklist(path: Path) -> List[int]:
    if not path.is_file():
        raise ConfigurationError(f"체크리스트 파일을 찾을 수 없습니다: {path}")

    author_ids: List[int] = []
    seen_ids: Set[int] = set()
    with path.open("r", encoding="utf-8") as checklist_file:
        for line_number, raw_line in enumerate(checklist_file, start=1):
            value = raw_line.strip()
            if not value:
                continue
            if not value.isdigit():
                raise ConfigurationError(f"체크리스트 {line_number}행이 숫자가 아닙니다: {value}")

            author_id = int(value)
            if author_id < MIN_AUTHOR_ID or author_id > MAX_AUTHOR_ID:
                raise ConfigurationError(
                    f"체크리스트 {line_number}행이 범위를 벗어났습니다: {author_id}"
                )
            if author_id in seen_ids:
                raise ConfigurationError(f"체크리스트에 중복 ID가 있습니다: {author_id}")

            seen_ids.add(author_id)
            author_ids.append(author_id)
    return author_ids


def load_author_names(path: Path) -> List[str]:
    if not path.exists():
        return []

    try:
        with path.open("r", encoding="utf-8") as author_file:
            values = json.load(author_file)
    except (OSError, json.JSONDecodeError) as error:
        raise ConfigurationError(f"author.json을 읽을 수 없습니다: {error}") from error

    if not isinstance(values, list):
        raise ConfigurationError("author.json의 최상위 값은 배열이어야 합니다.")
    if any(not isinstance(value, str) or not value.strip() for value in values):
        raise ConfigurationError("author.json에는 비어 있지 않은 문자열만 사용할 수 있습니다.")
    return list(values)


def merge_author_names(existing_names: Sequence[str], scraped_names: Iterable[str]) -> Tuple[List[str], int]:
    merged_names = list(existing_names)
    known_keys = {get_name_comparison_key(name) for name in existing_names}
    added_count = 0

    for raw_name in scraped_names:
        name = normalize_scraped_name(raw_name)
        key = get_name_comparison_key(name)
        if not key or key in known_keys:
            continue
        known_keys.add(key)
        merged_names.append(name)
        added_count += 1

    return merged_names, added_count


def atomic_write_text(path: Path, content: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    existing_mode = stat.S_IMODE(path.stat().st_mode) if path.exists() else 0o644
    file_descriptor, temporary_name = tempfile.mkstemp(
        prefix=f".{path.name}.",
        suffix=".tmp",
        dir=str(path.parent),
    )
    temporary_path = Path(temporary_name)

    try:
        with os.fdopen(file_descriptor, "w", encoding="utf-8", newline="\n") as temporary_file:
            temporary_file.write(content)
            temporary_file.flush()
            os.fsync(temporary_file.fileno())
        os.chmod(temporary_path, existing_mode)
        os.replace(temporary_path, path)

        if hasattr(os, "O_DIRECTORY"):
            try:
                directory_descriptor = os.open(path.parent, os.O_RDONLY | os.O_DIRECTORY)
                try:
                    os.fsync(directory_descriptor)
                finally:
                    os.close(directory_descriptor)
            except OSError:
                pass
    finally:
        if temporary_path.exists():
            temporary_path.unlink()


def write_author_names(path: Path, names: Sequence[str]) -> None:
    content = json.dumps(list(names), ensure_ascii=False, indent=4) + "\n"
    atomic_write_text(path, content)


def write_checklist(path: Path, author_ids: Sequence[int]) -> None:
    content = "" if not author_ids else "\n".join(str(author_id) for author_id in author_ids) + "\n"
    atomic_write_text(path, content)


def persist_success(
    author_id: int,
    scraped_names: Sequence[str],
    checklist_path: Path,
    output_path: Path,
) -> Tuple[int, int]:
    existing_names = load_author_names(output_path)
    merged_names, added_count = merge_author_names(existing_names, scraped_names)
    if added_count > 0 or not output_path.exists():
        write_author_names(output_path, merged_names)

    current_checklist = load_checklist(checklist_path)
    remaining_ids = [current_id for current_id in current_checklist if current_id != author_id]
    write_checklist(checklist_path, remaining_ids)
    return added_count, len(remaining_ids)


class CollectorLock:
    def __init__(self, path: Path) -> None:
        self.path = path
        self._lock_file: Optional[object] = None

    def __enter__(self) -> "CollectorLock":
        self.path.parent.mkdir(parents=True, exist_ok=True)
        file_descriptor = os.open(self.path, os.O_CREAT | os.O_RDWR, 0o644)
        lock_file = os.fdopen(file_descriptor, "r+", encoding="utf-8")
        try:
            self._acquire_os_lock(lock_file)
            lock_data = {
                "pid": os.getpid(),
                "started_at": datetime.now(timezone.utc).isoformat(),
            }
            lock_file.seek(0)
            lock_file.truncate()
            json.dump(lock_data, lock_file, ensure_ascii=False)
            lock_file.flush()
            os.fsync(lock_file.fileno())
        except Exception:
            lock_file.close()
            raise
        self._lock_file = lock_file
        return self

    def _acquire_os_lock(self, lock_file: object) -> None:
        if fcntl is not None:
            try:
                fcntl.flock(lock_file.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
            except BlockingIOError as error:
                raise ConfigurationError(f"다른 수집기가 실행 중입니다: {self.path}") from error
            return

        if msvcrt is not None:
            lock_file.seek(0, os.SEEK_END)
            if lock_file.tell() == 0:
                lock_file.write("\0")
                lock_file.flush()
            lock_file.seek(0)
            try:
                msvcrt.locking(lock_file.fileno(), msvcrt.LK_NBLCK, 1)
            except OSError as error:
                raise ConfigurationError(f"다른 수집기가 실행 중입니다: {self.path}") from error
            return

        raise ConfigurationError("이 운영체제에서는 수집기 파일 잠금을 지원하지 않습니다.")

    def __exit__(self, exc_type: object, exc_value: object, traceback: object) -> None:
        if self._lock_file is None:
            return
        try:
            if fcntl is not None:
                fcntl.flock(self._lock_file.fileno(), fcntl.LOCK_UN)
            elif msvcrt is not None:
                self._lock_file.seek(0)
                msvcrt.locking(self._lock_file.fileno(), msvcrt.LK_UNLCK, 1)
        finally:
            self._lock_file.close()
            self._lock_file = None


def format_elapsed(seconds: float) -> str:
    return f"{seconds:.2f}초"


def run_collection(
    request_count: int,
    checklist_path: Path,
    output_path: Path,
    timeout_seconds: float,
    max_consecutive_failures: int,
    rng: random.Random,
    stop_event: threading.Event,
    fetcher: Callable[[int, float], List[str]] = fetch_author_names,
    sleeper: Callable[[float], None] = time.sleep,
    monotonic: Callable[[], float] = time.monotonic,
) -> int:
    checklist = load_checklist(checklist_path)
    if not checklist:
        print("수집할 작가 ID가 없습니다.")
        return 0

    actual_count = min(request_count, len(checklist))
    if actual_count < request_count:
        print(f"남은 ID가 {len(checklist)}개이므로 수집 횟수를 {actual_count}회로 조정합니다.")

    selected_ids = rng.sample(checklist, actual_count)
    started_at = monotonic()
    success_count = 0
    failure_count = 0
    added_name_count = 0
    consecutive_failures = 0
    stopped_early = False

    print(
        f"수집 시작: 요청 {actual_count}회, 순차 실행, "
        f"요청 전 지연 {MIN_REQUEST_DELAY_SECONDS:.0f}~{MAX_REQUEST_DELAY_SECONDS:.0f}초"
    )

    for index, author_id in enumerate(selected_ids, start=1):
        if stop_event.is_set():
            stopped_early = True
            break

        delay_seconds = rng.uniform(MIN_REQUEST_DELAY_SECONDS, MAX_REQUEST_DELAY_SECONDS)
        print(f"[{index}/{actual_count}] id={author_id} 요청 전 {delay_seconds:.2f}초 대기")
        sleeper(delay_seconds)
        if stop_event.is_set():
            stopped_early = True
            break

        request_started_at = monotonic()
        try:
            scraped_names = fetcher(author_id, timeout_seconds)
            request_seconds = monotonic() - request_started_at
            added_count, remaining_count = persist_success(
                author_id,
                scraped_names,
                checklist_path,
                output_path,
            )
            success_count += 1
            added_name_count += added_count
            consecutive_failures = 0
            elapsed_seconds = monotonic() - started_at
            names_text = " | ".join(scraped_names)
            print(
                f"[{index}/{actual_count}] id={author_id} 성공 "
                f"names=\"{names_text}\" added={added_count} request={request_seconds:.2f}초 "
                f"total={format_elapsed(elapsed_seconds)} remaining={remaining_count}"
            )
        except StopCollectionError as error:
            failure_count += 1
            stopped_early = True
            elapsed_seconds = monotonic() - started_at
            print(
                f"[{index}/{actual_count}] id={author_id} 중단: {error} "
                f"total={format_elapsed(elapsed_seconds)}",
                file=sys.stderr,
            )
            break
        except CollectorError as error:
            failure_count += 1
            consecutive_failures += 1
            elapsed_seconds = monotonic() - started_at
            print(
                f"[{index}/{actual_count}] id={author_id} 실패: {error} "
                f"total={format_elapsed(elapsed_seconds)}",
                file=sys.stderr,
            )
            if consecutive_failures >= max_consecutive_failures:
                stopped_early = True
                print(
                    f"연속 실패 {consecutive_failures}회로 추가 요청을 중단합니다.",
                    file=sys.stderr,
                )
                break

    total_seconds = monotonic() - started_at
    print(
        f"작업 종료: 성공={success_count}, 실패={failure_count}, "
        f"신규 이름={added_name_count}, total={format_elapsed(total_seconds)}"
    )
    return 2 if stopped_early else 0


def positive_integer(value: str) -> int:
    try:
        parsed_value = int(value)
    except ValueError as error:
        raise argparse.ArgumentTypeError("양의 정수를 입력하세요.") from error
    if parsed_value <= 0:
        raise argparse.ArgumentTypeError("1 이상의 정수를 입력하세요.")
    return parsed_value


def positive_float(value: str) -> float:
    try:
        parsed_value = float(value)
    except ValueError as error:
        raise argparse.ArgumentTypeError("양수를 입력하세요.") from error
    if parsed_value <= 0:
        raise argparse.ArgumentTypeError("0보다 큰 값을 입력하세요.")
    return parsed_value


def parse_arguments(argv: Optional[Sequence[str]] = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="author_checklist.txt에서 무작위 ID를 골라 RIDI 작가명을 수집합니다."
    )
    parser.add_argument("request_count", nargs="?", type=positive_integer, help="수집할 페이지 수")
    parser.add_argument("-n", "--count", dest="count_option", type=positive_integer, help="수집할 페이지 수")
    parser.add_argument("--checklist", type=Path, default=DEFAULT_CHECKLIST_PATH, help="체크리스트 경로")
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT_PATH, help="author.json 경로")
    parser.add_argument(
        "--timeout",
        type=positive_float,
        default=DEFAULT_TIMEOUT_SECONDS,
        help=f"네트워크 소켓 대기 제한 시간(초, 기본 {DEFAULT_TIMEOUT_SECONDS:g})",
    )
    parser.add_argument(
        "--max-consecutive-failures",
        type=positive_integer,
        default=DEFAULT_MAX_CONSECUTIVE_FAILURES,
        help=f"연속 실패 중단 기준(기본 {DEFAULT_MAX_CONSECUTIVE_FAILURES})",
    )
    parser.add_argument("--seed", type=int, help="무작위 선택 재현용 시드")
    parser.add_argument("--dry-run", action="store_true", help="요청 없이 선택될 ID만 출력")
    args = parser.parse_args(argv)

    if args.request_count is not None and args.count_option is not None:
        parser.error("위치 인수와 --count 중 하나만 사용하세요.")
    args.request_count = args.count_option if args.count_option is not None else args.request_count
    return args


def prompt_request_count() -> int:
    while True:
        try:
            raw_value = input("수집할 페이지 수를 입력하세요: ").strip()
        except EOFError as error:
            raise ConfigurationError("수집 횟수를 인수 또는 --count로 지정하세요.") from error
        try:
            return positive_integer(raw_value)
        except argparse.ArgumentTypeError as error:
            print(error, file=sys.stderr)


def install_signal_handlers(stop_event: threading.Event) -> None:
    def request_stop(signum: int, frame: object) -> None:
        stop_event.set()
        print("\n중단 요청을 받았습니다. 현재 단계가 끝나면 종료합니다.", file=sys.stderr)

    signal.signal(signal.SIGINT, request_stop)
    if hasattr(signal, "SIGTERM"):
        signal.signal(signal.SIGTERM, request_stop)


def main(argv: Optional[Sequence[str]] = None) -> int:
    args = parse_arguments(argv)
    request_count = args.request_count or prompt_request_count()
    checklist_path = args.checklist.expanduser().resolve()
    output_path = args.output.expanduser().resolve()
    rng = random.Random(args.seed) if args.seed is not None else random.SystemRandom()

    try:
        checklist = load_checklist(checklist_path)
        if args.dry_run:
            selected_count = min(request_count, len(checklist))
            selected_ids = rng.sample(checklist, selected_count)
            print("\n".join(str(author_id) for author_id in selected_ids))
            return 0

        stop_event = threading.Event()
        install_signal_handlers(stop_event)
        with CollectorLock(DEFAULT_LOCK_PATH):
            return run_collection(
                request_count=request_count,
                checklist_path=checklist_path,
                output_path=output_path,
                timeout_seconds=args.timeout,
                max_consecutive_failures=args.max_consecutive_failures,
                rng=rng,
                stop_event=stop_event,
            )
    except ConfigurationError as error:
        print(f"설정 오류: {error}", file=sys.stderr)
        return 1
    except KeyboardInterrupt:
        print("\n사용자가 작업을 중단했습니다.", file=sys.stderr)
        return 130


if __name__ == "__main__":
    raise SystemExit(main())
