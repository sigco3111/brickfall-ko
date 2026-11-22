# Brickfall (브릭폴) 한글화

짧은 1인칭 철거 게임 **Brickfall**의 한국어 번역 미러 저장소입니다.

- **원작**: [Patch — blendi/brickfall](https://patch.gg/games/blendi/brickfall) (제작: Patch, 엔진: [Steven Bobyn의 three-voxel-destruction](https://github.com/sbobyn/three-voxel-destruction))
- **이 저장소**: Patch의 오픈 소스 저장소(코드 MIT)를 바탕으로 한 **별도 한글화 미러**입니다. GitHub fork가 아니며, 원작과 무관하게 독립 운영됩니다.
- **플레이 (GitHub Pages)**: https://sigco3111.github.io/brickfall-ko/
- 원본 영문 README: [README.en.md](README.en.md)

![게임 화면](docs/gameplay-frame.jpg)
*원작 저장소에 포함된 게임 화면 프레임 (MIT, public/needs-webgpu.jpg)*

## 게임 소개

계약 하나가 작은 부지 하나와 제한 시간 하나입니다. 건물을 받치고 있는 것을 무너뜨리고, 층이 벽돌 하나하나씩 무너져 내리는 것을 지켜보세요. 모든 복셀은 그래픽 카드에서 시뮬레이션되는 실제 강체입니다. 벽은 이음새를 따라 갈라지고, 무너지는 구간은 닿는 쪽부터 층층이 부서지며, 잔해는 쌓인 자리에 그대로 남습니다.

- **모드 4종**: 러시(제한 시간 내 파괴), 블로우다운(장약으로 한 번에), 샌드박스(자유), 샐비지(전리품 회수)
- **부지 11곳**: 단층 주택부터 11층 타워, 바다 부두, 교회 첨탑까지
- **도구 9종**: 슬레지, 캐논, 장약, 절단 장약, 잭해머, 로켓, 파이프 폭탄, 판자, 케이블

## 한글화 내용

- 게임 내 전 UI 한글 번역: 타이틀, 모드 설명, 계약 브리핑, 도구 이름·힌트, 튜토리얼, 일시 정지·설정, 결과 화면, 크레딧 오버레이
- 게임패드 안내 문구도 한글로 표시 (Xbox/PlayStation 버튼 이름 자동 전환 유지)
- 한글 폰트 추가: **Black Han Sans**(제목), **Noto Sans KR**(본문) — 둘 다 SIL OFL 1.1
- `lang="ko"`, 로더·WebGPU 안내 화면 한글화

## 사운드 안내

원작 릴리스의 녹음 효과음 86개는 라이선스상 저장소에 포함될 수 없습니다(게임 내 사용만 허가). 이 저장소는 다음 상태로 배포됩니다.

- **67개 테이크**: Patch의 [voxel-destruction 블록](https://patch.gg/patch/voxel-destruction)(오픈 소스, 아트 CC-BY-4.0)에서 가져온 같은 이름의 **CC0·CC-BY 오픈 녹음**으로 채웠습니다. CC-BY 크레딧(richardemoore, YleArkisto, juskiddink, DWOBoyle 등 전체 목록)은 [CREDITS.md](CREDITS.md)와 게임 내 크레딧 오버레이에 표기되어 있습니다.
- **나머지 19개 테이크**(`boom`, `boom_tail`, `thud`, `plaster_*`, `groan_masonry`): 원작 저장소 설계대로 무음 스탠드인이 들어갑니다. 합성음(저음 타격, 균열, 울림, 발소리, 유리, 경보, 엔진)과 음악은 그대로 재생됩니다.
- 자세한 내용: [MISSING_ASSETS.md](MISSING_ASSETS.md)

## 기술 스택

- **언어/엔진**: TypeScript + [three.js](https://threejs.org) (WebGPU 렌더러)
- **물리**: [three-avbd](https://github.com/sbobyn/three-avbd) — GPU 강체 솔버 (AVBD, SIGGRAPH 2025)
- **빌드**: Vite → 정적 파일(dist/)
- **모델 없음**: 부지, 건물, 소품, 도구, 트럭 모두 코드 속 복셀과 박스로 생성
- **아트**: Poly Haven 텍스처·하늘(CC0), 폰트(OFL), 생성 음악

## 실행 방법

Node 22 이상, pnpm 10, WebGPU 지원 브라우저(Chrome/Edge 113+, Safari 26, Windows의 Firefox 141+)가 필요합니다.

```sh
pnpm install
pnpm dev          # http://127.0.0.1:5320
pnpm build        # dist/ 생성 (정적 배포용)
```

### 조작법

| 입력 | 동작 |
|---|---|
| WASD | 이동 |
| 마우스 | 시점 (클릭으로 캡처, Esc 일시 정지) |
| 좌클릭 | 도구 사용 |
| 1–9 / 휠 | 도구 전환 |
| 우클릭 또는 Q | 장약 기폭 |
| R | 장약 지연 설정 |
| L | 하중 보기 |
| Space / Shift / C | 점프 / 달리기 / 앉기 |
| F | 전리품 줍기 (샐비지) |
| B / T (샌드박스) | 소품 소환 / 시간대 변경 |

게임패드(표준 매핑)도 지원합니다. 화면 안내가 패드 버튼 이름에 맞춰 바뀝니다.

## 검증 상태

- `pnpm typecheck`(tsc) 통과, `pnpm test` 9/9 통과, `pnpm build` 통과
- 실제 플레이 화면은 WebGPU가 필요하여 빌드 환경에서는 확인하지 못했습니다. PC Chrome/Edge에서 플레이해 보시고 이상이 있으면 알려 주세요.

## 라이선스

- 코드: MIT ([LICENSE](LICENSE)) — Steven Bobyn의 엔진 + Patch의 게임
- 텍스처·하늘: CC0 (Poly Haven) / 폰트: OFL 1.1 / three.js·three-avbd: MIT (`public/LICENSES/`)
- 오픈 효과음: CC0 및 CC-BY-4.0 (개별 출처·크레딧은 [CREDITS.md](CREDITS.md))
- 추가하는 사운드는 각 사운드의 라이선스를 따릅니다.

원작: Patch. 원작자가 이 목록을 권리 주장할 수 있습니다.
