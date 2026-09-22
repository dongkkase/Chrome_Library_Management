# Google Drive 동기화 배포 설정

## 배포 전에 준비할 항목

1. Google Cloud 프로젝트에서 Google Drive API를 사용 설정합니다.
2. Google Auth Platform에서 앱 이름, 지원 이메일, 개인정보처리방침과 동의 화면을 설정합니다. 일반 사용자에게 배포할 때는 테스트 사용자 제한이 적용되지 않도록 게시 상태를 확인합니다.
3. OAuth 클라이언트를 **Chrome 확장 프로그램** 유형으로 생성합니다. 확장 프로그램 ID는 `kjfmielegfhljmjjmhjmidlfdponknpm`입니다.
4. `https://www.googleapis.com/auth/drive.appdata` 범위만 설정합니다. 다른 Drive 파일을 읽는 권한은 필요하지 않습니다.
5. 생성된 클라이언트 ID로 배포 ZIP을 만듭니다. 클라이언트 보안 비밀은 사용하지 않습니다.

```bash
node scripts/package-extension.mjs \
    --client-id '실제-클라이언트-ID.apps.googleusercontent.com' \
    --output /tmp/book-manager-google-sync.zip
```

명령의 예시 ID는 실제 Google Cloud 값으로 교체해야 합니다. Node.js와 `zip` 명령이 필요합니다. 기존 출력 파일은 덮어쓰지 않습니다. 소스의 `manifest.json`은 변경하지 않고 배포 ZIP에만 `oauth2`와 웹스토어 업데이트 주소를 추가합니다. ZIP에는 새 동기화 스크립트 3개가 포함됩니다. 원본 manifest에는 OAuth ID를 임의로 넣지 않았으므로, 설정 전에는 Google 연결 버튼이 활성화되지 않습니다.

웹스토어에 ZIP을 게시하기 전 manifest 버전 번호도 기존 게시 버전보다 높게 변경해야 합니다. 기존 웹스토어 항목에 게시해야 하며 새 ID로 게시하는 경우 `google-sync.js`의 `STORE_ID` 및 OAuth 클라이언트의 확장 ID를 함께 변경해야 합니다.

## 직접 설치용 배포 파일

직접 설치본도 같은 Google OAuth 클라이언트를 사용할 수 있습니다. 웹스토어 확장의 공개키를 `manifest.key`에 넣어 압축 해제 설치본의 ID를 `kjfmielegfhljmjjmhjmidlfdponknpm`으로 고정해야 합니다. Chrome의 [OAuth 공식 안내](https://developer.chrome.com/docs/extensions/how-to/integrate/oauth)에서 설명하는 방식입니다.

1. Chrome 개발자 대시보드에서 **기존 웹스토어 항목**의 `Package → View public key`를 엽니다.
2. 공개키를 `book-manager-public-key.pem` 파일로 저장합니다. `BEGIN PUBLIC KEY` / `END PUBLIC KEY`가 포함된 PEM 또는 내부 Base64 값 모두 사용할 수 있습니다. 개인키는 사용하지 않습니다.
3. 웹스토어용과 같은 OAuth 클라이언트 ID로 직접 설치용 ZIP을 만듭니다.

```bash
node scripts/package-extension.mjs \
    --target manual \
    --client-id '실제-클라이언트-ID.apps.googleusercontent.com' \
    --public-key-file /path/book-manager-public-key.pem \
    --output /tmp/book-manager-google-sync-manual.zip
```

스크립트는 공개키에서 계산한 확장 ID가 등록된 ID와 맞는지 검사합니다. 잘못된 공개키나 개인키로는 패키지를 만들지 않습니다. 직접 설치용 ZIP에는 `key`와 `oauth2`를 넣고 웹스토어 자동 업데이트 주소를 제외합니다. 원본 manifest와 사용자가 설치한 확장은 변경하지 않습니다. 압축을 푼 폴더를 Chrome의 `압축해제된 확장 프로그램을 로드합니다`로 설치합니다.

같은 Google 계정을 연결하면 웹스토어 설치본과 직접 설치본에서 동일한 Drive DB를 사용할 수 있습니다. Google 연결 설정은 배포자가 준비하므로 일반 사용자가 각자 Cloud 프로젝트나 OAuth 클라이언트를 만들 필요는 없습니다. 같은 ID의 웹스토어 설치본과 직접 설치본은 동일한 Chrome 프로필에 별도로 함께 설치하지 않습니다.

### 기존 직접 설치 사용자 전환

공개키가 없던 직접 설치본은 ID가 달랐을 수 있습니다. ID가 바뀌면 기존 IndexedDB와 설정을 새 설치본에서 자동으로 읽을 수 없으므로 다음 순서로 전환합니다.

1. 기존 설치본의 `데이터 백업 → 내 PC로 데이터 백업`으로 백업 파일을 저장합니다.
2. 기존 폴더를 덮어쓰거나 확장을 삭제하지 말고, 기존 확장을 비활성화합니다.
3. 동기화 지원 ZIP을 **별도 폴더**에 풀고 설치합니다.
4. 새 설치본의 `기존 데이터 복구`로 백업을 불러옵니다. 도서 건수와 누락 권수를 확인한 뒤 Google 계정을 연결합니다. 백업에 포함되지 않는 화면·다운로드 설정 등은 필요하면 다시 설정합니다.

이미 같은 고정 ID를 사용하고 있던 직접 설치본은 기존 업데이트 절차를 따를 수 있습니다. 공개키나 OAuth 설정이 빠진 배포 파일은 동기화 연결을 시작하지 않고 전환 안내를 표시합니다.

## 동작과 저장 범위

- 사용자가 `데이터 백업 → Google 계정 연결`을 누른 후에만 업로드합니다.
- 도서 DB 전체와 누락 권수만 동기화합니다. 사이트 설정, 필터, 다운로드 정보 및 로컬 복원 지점은 업로드하지 않습니다.
- Google Drive의 앱 전용 비공개 저장 공간인 `appDataFolder`에 `book-manager-db-v1.json`을 저장합니다. 일반 Drive 파일 목록에는 표시되지 않습니다.
- 기본값은 자동 동기화 켜짐, 5분 간격, Chrome 시작 시 확인, 도서 변경 후 약 30초 뒤 확인입니다. `동기화 옵션`에서 주기를 5·15·30·60분으로 선택하고 시작·변경 시 확인을 각각 끌 수 있습니다. 주기 확인은 시작·변경 시 확인과 별도로 동작합니다.
- 자동 동기화를 끄면 주기 및 도서 변경 알람을 해제하고, 시작 이벤트나 이미 전달된 알람에서도 새 자동 동기화를 시작하지 않습니다. Google 계정 연결 시 한 번 동기화하며, `지금 동기화`와 충돌 선택은 수동으로 실행할 수 있습니다. 이미 서버에 전송된 요청은 되돌리지 않습니다.
- 옵션은 `chrome.storage.local`의 `googleSyncPreferences`에 이 기기용으로 저장되며, Drive에 업로드하거나 연결 해제 시 삭제하지 않습니다. 연결 전에도 설정할 수 있습니다. Chrome이 실행 중이고 네트워크와 인증이 가능한 상태여야 하며, 브라우저가 알람 실행을 늦출 수 있습니다.
- 최초 연결 시 한쪽 목록이 비어 있으면 기존 목록을 사용합니다. 두 목록에 서로 다른 데이터가 있거나 마지막 동기화 이후 양쪽이 모두 변경되면, 사용자가 사용할 목록을 선택할 때까지 교체를 중단합니다. 제목이 같은 별도 행을 합치지 않습니다.
- 업로드·다운로드로 대상 목록의 도서가 삭제되는 경우에도 자동 적용을 멈춥니다. 파일 복구·로컬 복원 지점 적용 등으로 이 기기의 목록 전체를 교체한 경우, 기존 Google 파일을 찾지 못하거나 다른 파일로 바뀐 경우에도 사용할 목록을 확인합니다. 원격 파일이 없으면 이 기기 목록을 Google에 다시 저장하는 선택만 제공합니다.
- 확인 화면과 최종 확인 창에는 선택별 대상 목록의 추가·수정·삭제 건수를 표시합니다. 확인 대기 중에는 자동으로 목록을 교체하지 않으며, 두 목록이 같아진 경우에는 교체 없이 확인을 완료합니다. 선택 직전에 이 기기와 Google의 목록을 다시 읽으며, 확인했던 목록이 바뀌었으면 새로운 내용으로 다시 선택하게 합니다.
- 원격 파일의 해시·형식과 ETag를 검증하고 조건부 갱신합니다. 다른 기기가 먼저 저장하여 ETag가 달라졌으면 덮어쓰지 않습니다. 도서 삭제는 사용자 확인 후 반영하며, 누락 권수만 수정해도 동기화됩니다.
- Google 파일을 갱신하기 전 기존 원격 목록을 이 기기 IndexedDB의 `snapshots`에 `(Google 업로드 전 원격 목록)` 표시로 저장합니다. 내려받은 목록을 적용하기 전에는 이 기기의 기존 목록을 같은 IndexedDB 트랜잭션에서 `(Google 동기화 전)` 표시로 저장합니다. 복원 지점 저장에 실패하면 목록을 교체하지 않습니다.
- 동기화 복원 지점은 `kind: 'google-sync'`로 최근 10개를 보관하며, 일일 복원 지점 최근 7개와 별도로 관리합니다. `데이터 백업 → 타임머신`에서 이 기기로 복원할 수 있으며, 복원한 목록을 다른 기기에 반영하기 전 다시 확인합니다. 복원 지점은 Drive에 업로드하지 않습니다. 브라우저가 중간에 종료되면 적용 저널을 이용해 누락 권수와 동기화 기준을 복구합니다.
- 인증 토큰은 Chrome Identity 캐시에서 관리하며 저장소나 DB에 기록하지 않습니다. 마지막으로 연결된 계정과 다른 계정이 감지되면 동기화를 중단합니다.
- 연결 해제는 이 기기의 자동 동기화와 인증 캐시를 해제합니다. 도서 DB와 Drive 파일은 유지됩니다. Google 계정의 앱 접근 권한 철회는 계정 관리 화면에서 별도로 할 수 있습니다.

## 출시 전 확인

```bash
node --test test/*.test.js
```

자동 테스트는 실제 Google 로그인을 대체하지 않습니다. 실제 OAuth 클라이언트와 공개키를 적용한 웹스토어·직접 설치본으로 아래 흐름을 확인해야 합니다.

- 첫 기기에서 연결하여 업로드하고, 같은 Google 계정의 다른 기기에서 내려받기
- 도서 추가·수정·삭제 및 누락 권수 변경 후 양방향 반영
- 두 기기를 오프라인으로 수정한 뒤 재연결하여 충돌 선택 및 로컬 복원
- 삭제가 포함된 업로드·다운로드, 파일 복구·전체 교체, 원격 파일 삭제·교체 시 확인 대기 및 변경 건수 안내
- 확인 대기 중 자동 동기화가 목록을 교체하지 않는지, 선택 직전 다른 기기가 수정하면 재확인을 요청하는지 확인
- 업로드 전 원격 목록과 다운로드 전 로컬 목록의 복원, 동기화 복원 지점 10개와 일일 복원 지점 7개의 별도 보관
- Google 권한 철회, 계정 변경, 네트워크 중단 후 재시도
- 자동 동기화 끄기, 주기 변경, 시작·변경 시 확인 선택 후 재시작과 수동 실행
- 공개키와 OAuth가 설정된 직접 설치본에서 연결하고 웹스토어 설치본과 동기화
- 설정이 누락되거나 확장 ID가 다른 직접 설치본에서는 인증을 시작하지 않는지 확인
- 기존 직접 설치본의 DB를 백업하고 고정 ID 설치본으로 복구하여 전환

두 기기의 첫 업로드가 동시에 시작되어 같은 이름의 파일이 두 개 생성되면 임의로 하나를 골라 덮어쓰지 않고 오류를 표시합니다. 이 경우 각 기기의 목록을 먼저 파일로 백업하고 동기화를 끈 뒤, Google Drive 설정의 앱 관리에서 이 앱의 숨겨진 데이터를 삭제하여 초기화할 수 있습니다. 초기화는 클라우드 사본을 삭제하므로 백업한 기준 기기 하나부터 다시 연결해야 합니다.

## 공식 참고 문서

- [Chrome Identity 및 OAuth 클라이언트](https://developer.chrome.com/docs/extensions/how-to/integrate/oauth)
- [Chrome Identity API](https://developer.chrome.com/docs/extensions/reference/api/identity)
- [확장 ID를 고정하는 manifest.key](https://developer.chrome.com/docs/extensions/reference/manifest/key)
- [Google Drive 앱 전용 데이터](https://developers.google.com/workspace/drive/api/guides/appdata)
- [Drive v2 파일 리소스와 ETag](https://developers.google.com/workspace/drive/api/reference/rest/v2/files)

파일의 ETag 필드를 이용한 조건부 갱신을 위해 Drive v2 REST API를 사용합니다.
