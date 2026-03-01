### 최초 설치 방법

1. 받으신 `libmanagement.zip` 파일의 압축을 해제합니다.
2. 크롬 주소창에 `chrome://extensions`를 입력하여 이동합니다.
3. 오른쪽 상단의 `개발자 모드`를 ON으로 켭니다.
4. 왼쪽 상단의 `압축해제된 확장 프로그램을 로드합니다` 버튼을 클릭합니다.
5. 압축을 푼 폴더(manifest.json 파일이 있는 폴더)를 선택하면 설치가 완료됩니다.

### 업데이트 방법 (새 버전이 나왔을 때)

1. [릴리즈](https://github.com/eyecandyzero-hub/Chrome_Library_Management/releases)에서 최신 파일을 다운로드 받습니다.
2. 새로 받은 압축 파일의 내용을 기존에 설치했던 폴더에 덮어쓰기 합니다.
3. `chrome://extensions` 페이지로 이동합니다.
4. 목록에서 도서 목록 매칭 매니저(libmanagement) 항목의 새로고침(↻) 아이콘을 클릭합니다.
5. 상단 메뉴의 `업데이트` 버튼을 누르면 최신 로직이 즉시 반영됩니다.

### 소개

- **실시간 소장 목록 비교**: 웹사이트에 올라온 만화/소설 게시물 제목을 분석하여, 내가 소장하고 있거나 추적 중인 작품인지 실시간으로 비교해 줍니다.
- **직관적인 시각화 (뱃지 & 취소선)**: 불필요한 자료는 취소선(제외)으로 지워주고, 모으는 중인 자료(미완)는 제목 옆에 해상도와 권수가 적힌 파란색 뱃지를 달아 한눈에 구분할 수 있게 해줍니다.
- **업데이트 알림**: 마우스 우클릭만으로 간편하게 작품을 등록/갱신할 수 있으며, 내가 가진 것보다 **더 높은 해상도나 최신 권수**가 올라오면 뱃지 안의 글자를 **빨간색**으로 강조해 줍니다.
- 도서뿐만 아니라 다른 자료 혹은 일반 게시물에서도 범용 사용 가능
- 플랫폼마다 일정하지 않은 규칙으로 올라는 제목을 적절하게 추출하여 등록록
- 기가파일, 고파일 페이지에 직접 접속하지 않아도 바로 다운로드 가능


관리프로그램램

![image](https://github.com/eyecandyzero-hub/Chrome_Library_Management/blob/main/images/1.png)

최신화 및 고해상도 체크

![image](https://github.com/eyecandyzero-hub/Chrome_Library_Management/blob/main/images/2.png)

제외 및 미완 처리시 알람 표기

![image](https://github.com/eyecandyzero-hub/Chrome_Library_Management/blob/main/images/3.png)

바로 다운로드 기능

![image](https://github.com/eyecandyzero-hub/Chrome_Library_Management/blob/main/images/10.png)
![image](https://github.com/eyecandyzero-hub/Chrome_Library_Management/blob/main/images/11.png)

썸네일 미리보기 기능

![image](https://github.com/eyecandyzero-hub/Chrome_Library_Management/blob/main/images/12.png)


### 주요 사용 방법

- 기능을 적용할 사이트 도메인을 입력해주세요.
  ![image](https://github.com/eyecandyzero-hub/Chrome_Library_Management/blob/main/images/4.png)
- 직접 입력(여러줄 입력하여 일괄 등록 가능)
  ![image](https://github.com/eyecandyzero-hub/Chrome_Library_Management/blob/main/images/5.png)
- 링크 오른쪽 클릭하여 추가 (단축키: 키보드 1key + 1 or 2key 조합하여 사용 가능)
  ![image](https://github.com/eyecandyzero-hub/Chrome_Library_Management/blob/main/images/6.png)
- 링크가 아니여도, 책 제목을 드래그한 뒤 오른쪽 클릭하여 추가 가능
  ![image](https://github.com/eyecandyzero-hub/Chrome_Library_Management/blob/main/images/7.png)


### 단점
- **과도한 매칭**: 유사도 기준을 80%로 설정했기 때문에, 시리즈물이 아닌데 제목이 매우 유사한 전혀 다른 책이 제외/미완 처리될 가능성이 있습니다  
    (문 스바루와 스바루는 1글자 밖에 차이 나지 않아서 같은 제목으로 매칭되버리는 문제)  
    ![image](https://github.com/eyecandyzero-hub/Chrome_Library_Management/blob/main/images/8.png)
    ![image](https://github.com/eyecandyzero-hub/Chrome_Library_Management/blob/main/images/9.png)
- **매칭 실패**: 제목 자체가 완전히 다른 별칭으로 등록되어 있거나(예: 원어 제목 vs 번역 제목), 정규표현식으로 제거되지 않는 특수한 기기호가 포함된 경우 매칭에 실패할 수 있습니다.
    - 제목의 패턴이 깔끔하지 않을수록 매칭실패율은 올라갑니다.


