### 사용가능한 브라우저
크롬, 크로미움 기반의 모든 브라우저 (Edge, 웨일 등)

### Chrome 웹 스토어 설치

1. [Chrome 웹 스토어](https://chromewebstore.google.com/detail/kjfmielegfhljmjjmhjmidlfdponknpm)에서 확장 프로그램을 설치합니다.
2. 신규 버전은 GitHub의 버전 정보를 기준으로 확인하며, 웹 스토어 설치본은 브라우저의 확장 프로그램 업데이트 기능으로 자동 업데이트됩니다.
3. 자동 업데이트가 지연될 때는 옵션 화면의 `업데이트 확인` 버튼을 누르면 Chrome 웹 스토어에서 즉시 업데이트를 확인하고, 다운로드가 준비되는 즉시 적용합니다.

> GitHub에 신규 버전이 먼저 공개된 경우 Chrome 웹 스토어의 심사와 게시가 완료될 때까지 `웹 스토어 배포 대기`로 표시될 수 있습니다.

### Google 도서 목록 동기화

1. Chrome 웹 스토어 설치본 또는 동기화를 지원하는 직접 설치본의 `데이터 백업` 탭에서 `Google 계정 연결`을 누르고 Google Drive 접근을 허용합니다.
2. 다른 Chrome에서도 같은 Google 계정을 연결하면 도서 목록과 누락 권수를 동기화할 수 있습니다. 연결 후 변경 사항은 자동으로 동기화하며, `지금 동기화`로 직접 실행할 수도 있습니다.
3. 두 목록이 모두 변경되었거나, 처음 연결한 목록이 다르거나, 적용 시 도서가 삭제되면 자동 적용을 멈춥니다. 파일 복구·전체 교체 후 또는 기존 Google 파일이 사라지거나 바뀐 경우에도 확인을 요청합니다. 추가·수정·삭제 건수를 보고 사용할 목록을 선택하세요. `이 기기 목록 사용`은 Google 목록을, `Google 목록 사용`은 이 기기 목록을 전체 교체합니다.
4. `연결 해제`를 누르면 이 기기의 자동 동기화를 중지합니다. 이 기기에 저장된 도서 목록은 유지됩니다.

- 도서 데이터는 Google Drive의 앱 전용 공간에 저장되며, 사이트 설정과 로컬 복원 지점은 동기화하지 않습니다.
- 확인 대기 중에는 자동으로 목록을 교체하지 않습니다. 두 목록이 같아지면 교체 없이 확인을 완료할 수 있습니다. 선택을 적용하기 직전에 두 목록을 다시 확인하며, 내용이 바뀌었으면 다시 선택해야 합니다. 저장 시에도 Google 파일의 변경 여부를 검사해 다른 기기가 먼저 저장한 내용을 덮어쓰지 않도록 합니다.
- 교체 전 Google 목록 또는 이 기기 목록을 이 기기의 복원 지점에 먼저 저장합니다. 동기화 복원 지점 최근 10개와 일일 복원 지점 최근 7개를 별도로 보관하며, `타임머신`에서 복원할 수 있습니다. 복원 지점 저장에 실패하면 목록을 교체하지 않습니다.
- 동기화 영역의 `동기화 옵션`에서 자동 동기화를 켜거나 끄고, 확인 주기(5·15·30·60분)와 Chrome 시작 시·목록 변경 시 확인 여부를 설정할 수 있습니다. 변경 즉시 이 기기에 저장되며 연결 해제 후에도 유지됩니다. 자동 동기화를 꺼도 계정 연결 시 한 번 동기화하며, `지금 동기화`로 직접 실행할 수 있습니다.
- 직접 설치본은 공개키와 OAuth 설정이 포함된 동기화 지원 배포 파일을 사용해야 합니다. 기존 직접 설치본에서 처음 전환할 때는 확장 ID가 바뀔 수 있으므로 먼저 파일로 백업하고, 새 설치본에서 복구해 주세요. Google 계정을 연결하기 전에는 도서 데이터를 업로드하지 않습니다.
- 인증이나 네트워크 오류가 발생하면 `데이터 백업` 탭에서 오류를 확인하고 다시 연결하거나 동기화를 실행하세요.
- 개발자용 OAuth 설정과 배포 ZIP 생성 방법은 [Google 동기화 배포 설정](GOOGLE_SYNC_SETUP.md)을 참고하세요.

### GitHub 직접 설치

1. [릴리즈](https://github.com/dongkkase/Chrome_Library_Management/releases)에서 최신 버전의 `libmanagement.zip` 파일을 다운로드 받습니다.
2. 받으신 `libmanagement.zip` 파일의 압축을 해제하여 `libmanagement` 폴더 아래 소스들이 위치하게 합니다.
3. 크롬 주소창에 `chrome://extensions`를 입력하여 이동합니다.
4. 오른쪽 상단의 `개발자 모드`를 ON으로 켭니다.
5. 왼쪽 상단의 `압축해제된 확장 프로그램을 로드합니다` 버튼을 클릭합니다.
6. 압축을 푼 폴더(manifest.json 파일이 있는 폴더)를 선택하면 설치가 완료됩니다.

### GitHub 직접 설치본 업데이트

1. [릴리즈](https://github.com/dongkkase/Chrome_Library_Management/releases)에서 최신 버전의 `libmanagement.zip` 파일을 다운로드 받습니다.
2. 새로 받은 압축 파일의 내용을 기존에 설치했던 폴더에 덮어쓰기 합니다.
3. `chrome://extensions` 페이지로 이동합니다.
4. 목록에서 도서 목록 매칭 매니저(libmanagement) 항목의 새로고침(↻) 아이콘을 클릭합니다.
5. 상단 메뉴의 `업데이트` 버튼을 누르면 최신 로직이 즉시 반영됩니다. 

### 소개

- **실시간 소장 목록 비교**: 웹사이트에 올라온 만화/소설 게시물 제목을 분석하여, 내가 소장하고 있거나 추적 중인 작품인지 실시간으로 비교해 줍니다.
- **직관적인 시각화 (뱃지 & 취소선)**: 불필요한 자료는 취소선(제외)으로 지워주고, 모으는 중인 자료(미완)는 제목 옆에 해상도와 권수가 적힌 파란색 뱃지를 달아 한눈에 구분할 수 있게 해줍니다.
- **업데이트 알림**: 
  - 마우스 우클릭, 뱃지 클릭 만으로 간편하게 작품을 등록/갱신/삭제할 수 있으며, 
  - 내가 가진 것보다 **더 높은 해상도나 최신 권수**가 올라오면 뱃지 안의 글자를 **빨간색**으로 강조해 줍니다.
  - 누락관리: 빠진 권 수를 쉽게 설정하고, 강조하여 표시해줍니다.
- 도서뿐만 아니라 다른 자료 혹은 일반 게시물에서도 범용 사용 가능
- 플랫폼마다 일정하지 않은 규칙으로 올라는 제목을 적절하게 추출하여 등록
- 기가파일, 고파일 페이지에 직접 접속하지 않아도 바로 다운로드 가능
- 게시물의 의미 없는 댓글들을 숨겨줍니다.
- 추출한 책 제목으로 에브리띵과 연동되어 검색합니다.
- **게시물 숨김**: 제외, 완결, 미완, 번역, 신작으로 분류된 게시물을 선택적으로 숨길 수 있으며, 퀵 메뉴에서 표시 여부를 바로 전환할 수 있습니다. (해상도/권수 업그레이드 및 누락 데이터가 있는 경우(제외 항목은 무관), 또는 매칭률 95% 이하인 '제외' 항목은 숨김을 무시하고 표시됩니다.)



<br><img src='https://github.com/dongkkase/Chrome_Library_Management/blob/main/demo/before_after1.png?v=4'/>
<br><img src='https://github.com/dongkkase/Chrome_Library_Management/blob/main/demo/before_after2.png?v=4'/>

<br><img src='https://github.com/dongkkase/Chrome_Library_Management/blob/main/demo/1.png?v=4'/>
<br><img src='https://github.com/dongkkase/Chrome_Library_Management/blob/main/demo/1_2.png?v=4'/>
<br><img src='https://github.com/dongkkase/Chrome_Library_Management/blob/main/demo/1_3.png?v=4'/>

--- 

- **최신화, 고해상도, 누락 체크** 
  <br><img src='https://github.com/dongkkase/Chrome_Library_Management/blob/main/demo/2.png?v=4'/>

- **제외, 미완, 완결, 삭제 처리시 알람 표기** 
  <br><img src='https://github.com/dongkkase/Chrome_Library_Management/blob/main/demo/3.png?v=4'/>

- **누락 권 관리** 
  <br><img src='https://github.com/dongkkase/Chrome_Library_Management/blob/main/demo/16.png?v=4'/>

- **게시물 숨김 처리** 
  <br><img src='https://github.com/dongkkase/Chrome_Library_Management/blob/main/demo/17.gif?v=4'/>

- **바로 다운로드 기능** 
  <br><img src='https://github.com/dongkkase/Chrome_Library_Management/blob/main/demo/10.png?v=4'/>
  <br><img src='https://github.com/dongkkase/Chrome_Library_Management/blob/main/demo/11.png?v=4'/>

- **썸네일 미리보기 기능** 
  <br><img src='https://github.com/dongkkase/Chrome_Library_Management/blob/main/demo/12.png?v=4'/>

- **타 사이트에서도 사용 가능** 
  <br><img src='https://github.com/dongkkase/Chrome_Library_Management/blob/main/demo/13.png?v=4'/>
  사이트 상세페이지에서 책 제목 우 클릭하여 '이 요소를 상세페이지 제목으로 등록' 메뉴 클릭(사이트당 최초 1회 등록)
  <br><img src='https://github.com/dongkkase/Chrome_Library_Management/blob/main/demo/13_2.png?v=4'/>

- **기본 퀵 등록 버튼** 
  <br><img src='https://github.com/dongkkase/Chrome_Library_Management/blob/main/demo/13_3.png?v=4'/>
  - **제외 등록시** 
  <br><img src='https://github.com/dongkkase/Chrome_Library_Management/blob/main/demo/13_4.png?v=4'/>
  - **미완 등록시** 
  <br><img src='https://github.com/dongkkase/Chrome_Library_Management/blob/main/demo/13_5.png?v=4'/>
  - **완결 등록시** 
  <br><img src='https://github.com/dongkkase/Chrome_Library_Management/blob/main/demo/13_6.png?v=4'/>

---

### 주요 사용 방법

- 기능을 적용할 사이트 도메인을 입력해주세요.
  <br><img src='https://github.com/dongkkase/Chrome_Library_Management/blob/main/demo/4.png?v=4'/>
- 필터링 관리
  <br><img src='https://github.com/dongkkase/Chrome_Library_Management/blob/main/demo/15.png?v=4'/>
- 직접 입력(여러줄 입력하여 일괄 등록 가능)
  <br><img src='https://github.com/dongkkase/Chrome_Library_Management/blob/main/demo/5.png?v=4'/>
- 링크 오른쪽 클릭하여 추가 (단축키: 키보드 1key + 1 or 2key 조합하여 사용 가능)
  <br><img src='https://github.com/dongkkase/Chrome_Library_Management/blob/main/demo/6.png?v=4'/>
- 링크가 아니여도, 책 제목을 드래그한 뒤 오른쪽 클릭하여 추가 가능
  <br><img src='https://github.com/dongkkase/Chrome_Library_Management/blob/main/demo/7.png?v=4'/>

---

### 단점
- **과도한 매칭**: 유사도 기준을 80%로 설정했기 때문에, 시리즈물이 아닌데 제목이 매우 유사한 전혀 다른 책이 제외/미완 처리될 가능성이 있습니다  
    (문 스바루와 스바루는 1글자 밖에 차이 나지 않아서 같은 제목으로 매칭되버리는 문제)  
    <br><img src='https://github.com/dongkkase/Chrome_Library_Management/blob/main/demo/8.png?v=4'/>
    <br><img src='https://github.com/dongkkase/Chrome_Library_Management/blob/main/demo/9.png?v=4'/>
- **매칭 실패**: 제목 자체가 완전히 다른 별칭으로 등록되어 있거나(예: 원어 제목 vs 번역 제목), 정규표현식으로 제거되지 않는 특수한 기기호가 포함된 경우 매칭에 실패할 수 있습니다.
    - 제목의 패턴이 깔끔하지 않을수록 매칭실패율은 올라갑니다.
 
---

### 제목 판별이 안 되는(매칭 안 되는) 대표적인 5가지 경우
- 일본어(한자, 히라가나) 또는 기타 외국어로만 적힌 제목
  - 원인: 프로그램은 비교의 정확도를 높이기 위해 제목에서 **'한글, 영어, 숫자'**만 남기고 나머지는 모두 지워버립니다. (/[^a-zA-Z0-9가-힣\s]/g 정규식)
  - 결과: 만약 게시글 제목이 進撃の巨人 (진격의 거인) 처럼 한자/일본어로만 되어있다면, 필터링 후 글자가 아예 증발해버려 "제목 없음"으로 인식되고 매칭이 불가능해집니다.
- 제목이 너무 짧거나 자음/모음(초성)으로만 된 경우
  - 원인: 쓸데없는 기호나 오타가 매칭되는 것을 막기 위해, 글자 수가 1글자이거나 ㅋㅋㅋ, ㅎㅎ 같은 초성으로만 된 제목은 매칭 검사에서 아예 제외시켜버립니다.
  - 결과: 책 제목이 실제로 한 글자(예: "괭", "돈")인 경우, 게시글에 딱 저렇게만 적혀있으면 프로그램이 무시하고 넘어갑니다.
- '외전', '스핀오프' 단어의 유무가 다를 때
  - 원인: 원작과 외전을 헷갈려서 잘못 가리는 것을 방지하기 위해 엄격한 룰이 적용되어 있습니다.
  - 결과: 내 목록에는 나의 선배 (외전) 이라고 등록했는데, 게시판에는 그냥 나의 선배 라고 올라오면 유사도가 높아도 프로그램이 강제로 매칭률 0% 처리를 해버립니다. (반대의 경우도 마찬가지입니다.)
- 제목에 포함된 숫자가 다를 때 (권수 제외)
  - 원인: 제목 자체에 포함된 고유 숫자(예: 응답하라 1988, 20세기 소년)가 다르면 다른 작품으로 봅니다.
  - 결과: 사용자가 텍스트로 이십세기 소년이라고 등록해 뒀는데, 게시판에 20세기 소년이라고 올라오면 숫자가 일치하지 않아 다른 작품으로 인식할 확률이 높습니다.
- 지워지는 '필터 키워드'가 실제 제목인 경우
  - 원인: 프로그램은 지저분한 제목을 정리하기 위해 19금, 15금, 고화질, 완결, e북 같은 단어를 싹 다 지워버립니다.
  - 결과: 만약 실제 책 제목에 저 단어가 포함되어 있다면 (예: 만화 제목이 19금 남녀 인 경우), 19금이 지워지고 남녀만 남아 엉뚱한 작품과 매칭되거나 판별이 안 될 수 있습니다.
