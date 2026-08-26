# RIDI 작가명 수집기

`author_checklist.txt`에서 작가 ID를 무작위로 골라 RIDI 작가 페이지의
`.lang_kor`, `.lang_other` 값을 `author.json` 배열에 추가합니다.

## 실행

프로젝트 루트에서 수집할 페이지 수를 지정합니다.

```bash
python3 scripts/collect_ridi_authors.py --count 100
```

위치 인수를 사용하거나, 인수 없이 실행한 뒤 횟수를 입력할 수도 있습니다.

```bash
python3 scripts/collect_ridi_authors.py 100
python3 scripts/collect_ridi_authors.py
```

`--count`는 성공 건수가 아닌 최대 요청 횟수입니다. 실패한 페이지를 채우기 위해
추가 요청하지 않으므로 실행 전에 정한 트래픽 상한을 넘지 않습니다.

## 동작 방식

- 요청은 병렬화하지 않고 한 번에 하나씩 처리합니다.
- 각 요청 전에 1~3초의 무작위 지연을 적용합니다.
- 하나 이상의 작가명을 찾은 경우에만 성공으로 처리합니다.
- 성공한 ID는 저장 직후 체크리스트에서 제거하고, 실패한 ID는 남깁니다.
- `author.json`의 기존 순서와 값은 보존하며 새 이름만 정규화·중복 제거합니다.
- 각 결과에 요청 시간, 프로그램 시작 후 누적 시간, 남은 ID 수를 출력합니다.
- HTTP 401, 403, 429, 503, `Retry-After` 응답 또는 기본 5회 연속 실패 시 추가 요청을 중단합니다.
- 매 성공 건마다 두 파일을 임시 파일에 쓴 뒤 교체하므로 중간 종료 후 재실행할 수 있습니다.
- 동시에 두 수집기가 파일을 수정하지 않도록 운영체제 파일 잠금을 사용합니다.

전체 범위는 평균 지연 시간만 약 96시간이므로 작은 단위로 나누어 실행하는 편이 좋습니다.

## 요청 없는 점검

실제 요청과 파일 변경 없이 선택될 ID만 확인할 수 있습니다.

```bash
python3 scripts/collect_ridi_authors.py --count 10 --dry-run
```

선택 결과를 재현해야 할 때는 `--seed`를 함께 사용합니다.

```bash
python3 scripts/collect_ridi_authors.py --count 10 --seed 42 --dry-run
```

모든 옵션은 도움말에서 확인할 수 있습니다.

```bash
python3 scripts/collect_ridi_authors.py --help
```

`--timeout`은 전체 실행 시간이 아니라 개별 네트워크 소켓의 대기 제한 시간입니다.

## SSL 인증서 오류

수집기는 Python 기본 인증서 저장소가 비어 있으면 macOS와 Linux의 일반적인 시스템
CA 인증서 파일을 자동으로 사용합니다. 별도의 CA 인증서가 필요한 환경에서는 PEM
파일을 직접 지정할 수 있습니다.

```bash
python3 scripts/collect_ridi_authors.py --count 10 --ca-file /path/to/cert.pem
```

인증서 검증은 비활성화하지 않습니다.
