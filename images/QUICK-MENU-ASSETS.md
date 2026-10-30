# 퀵 메뉴 SVG 자산

확인 날짜: 2026-10-30

모든 자산은 확장 프로그램에 로컬 파일로 포함됩니다. SVG 안에 외부 이미지, 웹폰트, 스크립트 또는 HTML `foreignObject`를 사용하지 않습니다.

## 일반 동작 아이콘

- 제공자: [Font Awesome Free](https://fontawesome.com/), Fonticons, Inc.
- 고정 버전: [7.3.1](https://github.com/FortAwesome/Font-Awesome/tree/7.3.1/svgs/solid)
- SVG 라이선스: [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/)
- 배포 라이선스 원문: [FONT-AWESOME-LICENSE.txt](FONT-AWESOME-LICENSE.txt)
- 변경 사항: 유색 퀵 버튼 위에서 사용할 수 있도록 path의 채우기를 흰색(`#ffffff`)으로 지정했습니다. 원본 경로와 저작권 고지는 유지했습니다.

| 로컬 파일 | Font Awesome 원본 | 용도 |
| --- | --- | --- |
| `quick-copy.svg` | `copy.svg` | 제목 복사 |
| `quick-exclude.svg` | `ban.svg` | 제외 등록 |
| `quick-incomplete.svg` | `hourglass-half.svg` | 미완 등록 |
| `quick-complete.svg` | `check.svg` | 완결 등록 |
| `quick-delete.svg` | `trash-can.svg` | 등록 삭제 |
| `quick-missing.svg` | `list-check.svg` | 누락 권수 관리 |
| `quick-edit.svg` | `pen-to-square.svg` | 제목 정정 |
| `quick-category.svg` | `folder-open.svg` | 등록 분류 |

원본 URL 형식: `https://raw.githubusercontent.com/FortAwesome/Font-Awesome/7.3.1/svgs/solid/{원본 파일명}`

## 검색 서비스 로고

로고는 각 검색 대상 서비스를 식별하기 위해 사용합니다. 브랜드 로고의 상표권과 저작권은 각 권리자에게 있으며, 위의 Font Awesome 라이선스를 브랜드 로고에 적용하지 않습니다.

- `logo-google.svg`
    - 권리자: Google LLC.
    - 출처: [Google 공식 브랜드 자산 안내](https://developers.google.com/identity/branding-guidelines), [공식 SVG 배포 ZIP](https://developers.google.com/static/identity/images/signin-assets.zip).
    - ZIP 내부 원본: `Android + Web/SVG/Light/Theme=Light, Show text=No, Shape=Square, Platform=Android+Web.svg`.
    - G 로고의 윤곽, 색상 및 필터를 유지하고 로그인 버튼의 배경/테두리를 제거했습니다. 원본 Figma SVG의 HTML conic-gradient는 이미지 요소에서 표시되지 않으므로 동일 색상 보간을 사용하는 네이티브 SVG 경로로 변환했습니다. 글꼴이나 비트맵에 의존하지 않습니다.
    - 표시할 때 원래 가로세로 비율과 흰색 배경을 유지합니다.
- `logo-ridi.svg`
    - 권리자: RIDI Corporation.
    - 출처: [리디 회사 사이트의 공식 SVG](https://ridicorp.com/wp-content/uploads/2022/03/ridi.svg).
    - 원본을 그대로 포함했습니다. 61:23 비율의 워드마크이므로 `object-fit: contain` 등으로 원래 비율을 유지합니다.
- `logo-everything.svg`
    - Everything 및 해당 로고의 권리자: voidtools.
    - 참고: [Everything 공식 사이트](https://www.voidtools.com/), [공식 아이콘](https://www.voidtools.com/e2.png).
    - 공식 포럼의 [SVG 공유 글](https://www.voidtools.com/forum/viewtopic.php?t=14950)은 확인했으나 첨부 파일은 로그인 없이 내려받을 수 없었습니다.
    - 공식 아이콘의 주황색 돋보기 형태를 참고해 이 프로젝트에서 벡터로 재현했습니다. 공식 SVG 원본이 아니며, 확대 시 비트맵이 깨지지 않도록 경로와 그라데이션으로 구성했습니다.
