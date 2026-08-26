import gzip
import importlib.util
import json
import sys
import tempfile
import unittest
from email.message import Message
from pathlib import Path
from urllib.error import HTTPError


SCRIPT_PATH = Path(__file__).resolve().parent.parent / "scripts" / "collect_ridi_authors.py"
SPEC = importlib.util.spec_from_file_location("collect_ridi_authors", SCRIPT_PATH)
COLLECTOR = importlib.util.module_from_spec(SPEC)
assert SPEC.loader is not None
sys.modules[SPEC.name] = COLLECTOR
SPEC.loader.exec_module(COLLECTOR)


class FakeResponse:
    def __init__(
        self,
        body,
        url,
        status=200,
        content_encoding="",
        content_type="text/html; charset=utf-8",
    ):
        self._body = body
        self._url = url
        self.status = status
        self.headers = Message()
        self.headers["Content-Type"] = content_type
        if content_encoding:
            self.headers["Content-Encoding"] = content_encoding

    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc_value, traceback):
        return False

    def getcode(self):
        return self.status

    def geturl(self):
        return self._url

    def read(self, size=-1):
        return self._body if size < 0 else self._body[:size]


class FixedRandom:
    def sample(self, population, count):
        return list(population[:count])

    def uniform(self, minimum, maximum):
        return 1.5


class AuthorParserTests(unittest.TestCase):
    def test_extracts_korean_and_other_names(self):
        html = """
            <h1 class="author_name">
                <span class="selected lang_kor">무라카미 <b>하루키</b></span>
                <span class="lang_other other">Murakami&nbsp;Haruki</span>
            </h1>
        """
        self.assertEqual(
            COLLECTOR.extract_author_names(html),
            ["무라카미 하루키", "Murakami Haruki"],
        )

    def test_ignores_similar_classes_scripts_and_incomplete_elements(self):
        html = """
            <!-- <span class="lang_kor">주석</span> -->
            <script>const fake = '<span class="lang_kor">스크립트</span>';</script>
            <span class="lang_korean">유사 클래스</span>
            <span class="xlang_kor">유사 클래스 2</span>
            <span class="lang_kor">정상<br>이름</span>
            <span class="lang_other">닫히지 않은 이름
        """
        self.assertEqual(COLLECTOR.extract_author_names(html), ["정상 이름"])

    def test_deduplicates_normalized_names(self):
        html = """
            <span class="lang_kor">Joan K. Rowling</span>
            <span class="lang_other">  joan   k. rowling  </span>
        """
        self.assertEqual(COLLECTOR.extract_author_names(html), ["Joan K. Rowling"])

    def test_ignores_capture_closed_by_unrelated_tag(self):
        html = '<span class="lang_kor">잘못된 값</div>'
        self.assertEqual(COLLECTOR.extract_author_names(html), [])

    def test_accepts_a_single_target_class(self):
        html = '<span class="lang_kor">백야</span>'
        self.assertEqual(COLLECTOR.extract_author_names(html), ["백야"])


class FetchTests(unittest.TestCase):
    def test_fetches_and_decodes_gzip_html(self):
        body = gzip.compress(
            '<span class="lang_kor">조앤.K.롤링</span><span class="lang_other">Joan K. Rowling</span>'.encode(
                "utf-8"
            )
        )

        def opener(request, timeout):
            self.assertEqual(timeout, 7)
            self.assertEqual(request.headers["Accept-encoding"], "gzip")
            return FakeResponse(body, "https://ridibooks.com/author/68726", content_encoding="gzip")

        self.assertEqual(
            COLLECTOR.fetch_author_names(68726, timeout_seconds=7, opener=opener),
            ["조앤.K.롤링", "Joan K. Rowling"],
        )

    def test_rejects_page_without_author_elements(self):
        def opener(request, timeout):
            return FakeResponse(b"<html><body>blocked</body></html>", "https://ridibooks.com/author/10")

        with self.assertRaises(COLLECTOR.CollectorError):
            COLLECTOR.fetch_author_names(10, opener=opener)

    def test_stops_on_rate_limit(self):
        def opener(request, timeout):
            headers = Message()
            headers["Retry-After"] = "120"
            raise HTTPError(request.full_url, 429, "Too Many Requests", headers, None)

        with self.assertRaises(COLLECTOR.StopCollectionError):
            COLLECTOR.fetch_author_names(10, opener=opener)

    def test_stops_when_rate_limit_is_returned_as_response(self):
        def opener(request, timeout):
            response = FakeResponse(
                b"<html></html>",
                "https://ridibooks.com/author/10",
                status=429,
            )
            response.headers["Retry-After"] = "120"
            return response

        with self.assertRaisesRegex(COLLECTOR.StopCollectionError, "Retry-After=120"):
            COLLECTOR.fetch_author_names(10, opener=opener)

    def test_rejects_invalid_response_encoding(self):
        def opener(request, timeout):
            return FakeResponse(
                b'<span class="lang_kor">\xff</span>',
                "https://ridibooks.com/author/10",
            )

        with self.assertRaisesRegex(COLLECTOR.CollectorError, "문자 인코딩"):
            COLLECTOR.fetch_author_names(10, opener=opener)

    def test_stops_on_service_unavailable(self):
        def opener(request, timeout):
            return FakeResponse(
                b"<html></html>",
                "https://ridibooks.com/author/10",
                status=503,
            )

        with self.assertRaises(COLLECTOR.StopCollectionError):
            COLLECTOR.fetch_author_names(10, opener=opener)

    def test_rejects_https_downgrade(self):
        def opener(request, timeout):
            return FakeResponse(
                '<span class="lang_kor">변조된 값</span>'.encode("utf-8"),
                "http://ridibooks.com/author/10",
            )

        with self.assertRaisesRegex(COLLECTOR.StopCollectionError, "HTTPS"):
            COLLECTOR.fetch_author_names(10, opener=opener)


class PersistenceTests(unittest.TestCase):
    def test_persists_names_before_removing_successful_id(self):
        with tempfile.TemporaryDirectory() as temporary_directory:
            root = Path(temporary_directory)
            checklist_path = root / "author_checklist.txt"
            output_path = root / "author.json"
            checklist_path.write_text("1\n2\n3\n", encoding="utf-8")
            output_path.write_text(
                json.dumps([" 기존필터", "Existing"], ensure_ascii=False),
                encoding="utf-8",
            )

            added_count, remaining_count = COLLECTOR.persist_success(
                2,
                ["existing", "신규 작가"],
                checklist_path,
                output_path,
            )

            self.assertEqual(added_count, 1)
            self.assertEqual(remaining_count, 2)
            self.assertEqual(
                json.loads(output_path.read_text(encoding="utf-8")),
                [" 기존필터", "Existing", "신규 작가"],
            )
            self.assertEqual(checklist_path.read_text(encoding="utf-8"), "1\n3\n")

    def test_run_collection_keeps_failed_id(self):
        with tempfile.TemporaryDirectory() as temporary_directory:
            root = Path(temporary_directory)
            checklist_path = root / "author_checklist.txt"
            output_path = root / "author.json"
            checklist_path.write_text("1\n2\n", encoding="utf-8")
            output_path.write_text("[]\n", encoding="utf-8")

            def fetcher(author_id, timeout):
                if author_id == 1:
                    return ["작가 1"]
                raise COLLECTOR.CollectorError("테스트 실패")

            exit_code = COLLECTOR.run_collection(
                request_count=2,
                checklist_path=checklist_path,
                output_path=output_path,
                timeout_seconds=1,
                max_consecutive_failures=5,
                rng=FixedRandom(),
                stop_event=COLLECTOR.threading.Event(),
                fetcher=fetcher,
                sleeper=lambda seconds: None,
                monotonic=lambda: 10.0,
            )

            self.assertEqual(exit_code, 0)
            self.assertEqual(json.loads(output_path.read_text(encoding="utf-8")), ["작가 1"])
            self.assertEqual(checklist_path.read_text(encoding="utf-8"), "2\n")

    def test_rejects_duplicate_checklist_ids(self):
        with tempfile.TemporaryDirectory() as temporary_directory:
            checklist_path = Path(temporary_directory) / "author_checklist.txt"
            checklist_path.write_text("1\n1\n", encoding="utf-8")
            with self.assertRaises(COLLECTOR.ConfigurationError):
                COLLECTOR.load_checklist(checklist_path)


class CollectorLockTests(unittest.TestCase):
    def test_rejects_a_second_collector_and_releases_the_lock(self):
        with tempfile.TemporaryDirectory() as temporary_directory:
            lock_path = Path(temporary_directory) / ".author-collector.lock"

            with COLLECTOR.CollectorLock(lock_path):
                with self.assertRaises(COLLECTOR.ConfigurationError):
                    with COLLECTOR.CollectorLock(lock_path):
                        pass

            with COLLECTOR.CollectorLock(lock_path):
                pass


if __name__ == "__main__":
    unittest.main()
