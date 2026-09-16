# 도로 CCTV 혼잡도 모니터

**Segmentation 기반 도로 CCTV의 도로 대비 차량 면적비를 활용한 교통 혼잡도 측정 시스템** — 웹 서비스.

```
점유율(occupancy) = 차량 클래스 픽셀 수 / 도로 클래스 픽셀 수
```

- **차량**: 파인튜닝한 YOLO-seg(car/bus/truck) 가 매 프레임 실시간 segmentation
- **도로**: 카메라는 고정이므로 **등록 시 1회** SAM3 로 도로를 찾고 사람이 픽셀 단위로 확정 (방향별로 나눔)
- **영상 소스**: 국가교통정보센터(ITS) CCTV Open API 실시간 HLS, 수동 업로드 영상/이미지, 임의 스트림 URL
- **저장**: PostgreSQL (카메라, 방향, 5초 단위 점유율 시계열, 응용 그룹, 분석 작업)

## 화면

| 경로 | 내용 |
|---|---|
| `/` 지도 관제 | KPI(등록/평균 점유율/지체·정체 수/검출 차량), 혼잡 단계 색 마커, 검색·노선·단계 필터, **타임라인 재생**(최근 1~24시간을 슬라이더로 되감기), 선택 카메라의 실시간 세그멘테이션·방향별 점유율·스파크라인. 카메라가 없으면 온보딩 안내 + "샘플로 시작" |
| `/register` CCTV 등록 | 3단계 스테퍼. ① ITS 실시간 CCTV(지도를 움직이면 자동 검색, 등록된 것 표시) / 드래그&드롭 업로드 / URL → ② **마스크 편집기** → ③ 정보 입력 + 미리보기 |
| `/cameras` 전체 CCTV | 격자(실시간 MJPEG, 차종 구분/단일 모드, HUD, 열 수) 와 **표 보기**(이름·지역 편집, 일괄 시작/정지/삭제) |
| `/cameras/:id` 상세 | 방향별 KPI(15분 평균 대비 추세), 실시간 화면(차종별·단일·도로만·원본, 원본 HLS), **캡처 저장**, 추이 차트(차량 수 막대, 혼잡 밴드, 다른 카메라와 비교, CSV), 혼잡 경보 목록, 요일×시간 히트맵, 업로드 영상 전체 분석, 마스크 재편집 |
| `/stats` 점유율 통계 | 노선/지역/구간/카메라별 최근 N분 평균, 정렬 표 + 스파크라인, 그룹 추이 차트, 지체 이상 경보 목록, CSV |
| `/apps` 응용 분석 | 그룹 리포트(프리셋 **한강 대교** 26개 교량). 현황 비교(방향별 막대, 시간대 프로필, 추이, 자동 인사이트), **일별 리포트**(날짜×교량 표, 피크 시간), **정책 시나리오**(통행 분산 시 점유율 추정), CSV·인쇄(PDF) |
| `/system` 시스템 | 모델·ITS·임계값·워커 상태, 샘플 카메라 생성 |

### 마스크 편집기 (등록 2단계)

- **도로 자동 제안**: SAM3 가 있으면 텍스트 "road", 없으면 SAM2.1 로 화면 하단 여러 점을 추론해 합칩니다 → 노란 미리보기를 원하는 방향 버튼으로 추가
- **SAM 점**(클릭 포함 / Shift·우클릭 제외) · **SAM 박스**(드래그) · **브러시 / 지우개**(픽셀 단위) · **다각형**(채우기 / 도로만 재할당)
- **분할선**: 중앙분리대를 따라 선을 긋고 적용하면 도로 픽셀이 선 왼쪽/오른쪽 방향으로 나뉩니다 (양방향 도로를 가장 빠르게 나누는 방법)
- 휠 확대, Space+드래그 이동, 실행취소/다시실행, 구멍 메우기, 단축키(S/X/B/E/P/L/H, [ ], 1~6, Enter, Esc)
- 검증: 도로 비율이 너무 작거나 방향에 픽셀이 없으면 경고

혼잡 단계(기본): 원활 < 8% ≤ 서행 < 15% ≤ 지체 < 25% ≤ 정체. `.env` 의 `CONGESTION_THRESHOLDS` 로 변경.

## 폴더 구조

```
traffic_project/
├── backend/
│   ├── run.py                  # uvicorn 실행
│   └── app/
│       ├── main.py             # FastAPI 앱, 프론트 정적 서빙
│       ├── config.py           # .env 설정
│       ├── api/                # REST 라우터 (its, snapshots, segment, cameras, stream, metrics, apps, system)
│       ├── db/                 # SQLAlchemy 세션·모델
│       ├── ml/                 # vehicle_seg(YOLO) · road_seg(SAM3/SAM2) · occupancy · render · registry
│       ├── services/           # its_client · media · stream_worker · worker_manager · video_jobs
│       ├── schemas/            # pydantic 스키마
│       └── utils/
├── frontend/                   # Vite + React + TypeScript (Leaflet, hls.js, recharts)
│   └── src/{api,components,lib,pages}
├── models/weights/             # yolov8s_seg_vehicle.pt, sam3.pt (git 제외)
├── data/                       # 런타임 데이터: cameras/{id}/snapshot.jpg, road_mask.png · uploads/ · snapshots/ (git 제외)
├── scripts/                    # setup.sh · init_db.sh · run_dev.sh · run_prod.sh · download_sam3.py
├── requirements.txt
└── .env.example
```

## 설치 (Docker 없이)

요구: Python ≥ 3.10, Node ≥ 18, PostgreSQL, ffmpeg(OpenCV 내장 FFmpeg 로 HLS 읽음).

```bash
# 1) 파이썬 가상환경(.venv) + 패키지 + .env + DB + 프론트 패키지
bash scripts/setup.sh              # 기본은 python3 로 .venv 생성. 특정 버전: PYTHON=/opt/homebrew/bin/python3.13 bash scripts/setup.sh
#    이후 실행 스크립트(run_dev.sh / run_prod.sh)는 .venv 가 있으면 자동으로 그것을 씁니다.
#    직접 활성화해서 쓰려면: source .venv/bin/activate

# 2) .env 채우기
#    ITS_API_KEY=...            국가교통정보센터에서 발급 (https://www.its.go.kr/opendata/opendataList?service=cctv)
#    DATABASE_URL=postgresql+psycopg://localhost:5433/traffic

# 3) 모델 가중치
#    models/weights/yolov8s_seg_vehicle.pt   ← 파인튜닝 결과 best.pt 복사 (.env YOLO_WEIGHTS)
#    models/weights/sam3.pt                  ← python scripts/download_sam3.py --token hf_xxx  (HF facebook/sam3 승인 필요, 3.4GB)
#    sam3.pt 가 없으면 SAM2.1 로 자동 대체됩니다 (점/박스 프롬프트만 가능, 텍스트 "road" 프롬프트 불가).
#    sam3.pt 가 있으면 등록 편집기의 "도로 자동 제안" 이 텍스트 프롬프트 "road" 로 동작합니다 (첫 호출 ~13초 로드, 이후 ~3초).
```

### PostgreSQL

macOS(Homebrew): `brew install postgresql@17 && brew services start postgresql@17`, 이후 `bash scripts/init_db.sh` 가 `DATABASE_URL` 의 DB 를 만듭니다.
이 저장소는 5432 에 다른 PostgreSQL(18, EDB 설치본)이 떠 있는 환경이라 **Homebrew 17 을 5433 포트**로 씁니다
(`/opt/homebrew/var/postgresql@17/postgresql.conf` 의 `port = 5433`). 기존 서버를 쓰려면 `DATABASE_URL` 만 바꾸면 됩니다. 테이블은 서버 시작 시 자동 생성됩니다.

## 실행

**그냥 보고 싶으면 이거 하나:**

```bash
./start.sh
```

포트 정리 → (필요하면) 프론트 설치·빌드 → FastAPI 실행 → 브라우저로 http://localhost:8000 열기 까지 한 번에 합니다.
소스를 고치면서 작업할 때는 `./start.sh dev` (Vite HMR, http://localhost:5173).
Vercel 페이지를 남들도 보게 하려면 `./start.sh share` (백엔드 + cloudflared 터널). 종료는 모두 `Ctrl+C`.

세부 스크립트:

| 스크립트 | 무엇을 하나 | 언제 쓰나 |
|---|---|---|
| `bash scripts/run_dev.sh` | FastAPI 를 `--reload` 로 :8000 에, Vite 개발 서버를 :5173 에 띄움. Vite 가 `/api` 요청을 8000 으로 프록시하고, 소스를 고치면 즉시 반영(HMR) | 코드를 고치면서 개발할 때 → http://localhost:5173 |
| `bash scripts/run_prod.sh` | `npm run build` 로 프론트를 `frontend/dist` 에 정적 빌드한 뒤 FastAPI **하나만** 띄워 페이지와 API 를 같은 :8000 에서 서비스 | 그냥 쓰거나 서버 한 대에 배포할 때 → http://localhost:8000 |

API 문서: http://localhost:8000/docs

## 배포: 프론트는 Vercel, 백엔드는 로컬(→ 나중에 클라우드)

프론트와 백엔드가 다른 도메인에 있으므로 **프론트에 백엔드 주소**, **백엔드에 프론트 출처(CORS)** 를 알려주면 됩니다.

1. **GitHub 푸시** — `.env`, `data/`, `models/weights/*.pt`, `frontend/dist` 는 `.gitignore` 로 제외됩니다 (키·가중치·영상은 올라가지 않음).
2. **Vercel 프로젝트 생성** — Import 후 설정:
   - Root Directory: `frontend`  (Framework: Vite, Build: `npm run build`, Output: `dist` 자동 인식)
   - Environment Variables: `VITE_API_BASE` = 백엔드 주소
     - 백엔드가 내 PC 에만 있을 때: `http://localhost:8000` — **내 PC 브라우저에서만** 동작합니다 (브라우저는 https 페이지에서도 localhost 호출을 허용). 다른 사람은 볼 수 없습니다.
     - 다른 사람도 보게 하려면 백엔드를 터널로 노출: **`./start.sh share`** — 백엔드와 cloudflared 터널을 같이 띄우고 `https://xxxx.trycloudflare.com` 주소를 찍어줍니다. 그 주소를 `VITE_API_BASE` 에 넣고 Redeploy. (무료 터널은 재시작마다 주소가 바뀌고, 창을 닫으면 끊깁니다)
     - 클라우드로 옮기면 그 주소로 바꾸고 Redeploy.
   - `frontend/vercel.json` 이 SPA 경로(`/cameras/3` 등)를 `index.html` 로 되돌립니다.
3. **백엔드 CORS** — `*.vercel.app` 은 기본 허용입니다. 커스텀 도메인을 쓰면 `.env` 의 `CORS_ORIGINS` 에 추가하고 재시작.
4. 로컬에서 백엔드만 실행: `bash scripts/run_prod.sh` (또는 `python backend/run.py`). 프론트를 Vercel 에서 보더라도 로컬 dist 가 함께 서비스되는 것은 문제 없습니다.

주의: Vercel(https) 페이지에서 ITS 의 `http://` HLS 원본을 hls.js 로 직접 재생하는 것은 브라우저가 막습니다(혼합 콘텐츠). 세그멘테이션 스트림(MJPEG)은 백엔드를 거치므로 영향이 없고, 원본 재생이 필요하면 등록 시 cctvType **4 (https)** 를 고르세요.

나중에 백엔드를 클라우드로 옮길 때 필요한 것: GPU 인스턴스(또는 CPU 로 `INFER_FPS` 낮춤), PostgreSQL(RDS 등)로 `DATABASE_URL` 변경, `data/` 디렉터리 영속 볼륨, `models/weights/` 복사.

## 사용 흐름

1. **CCTV 등록** → ITS 탭에서 지도를 원하는 곳으로 옮기고 "현재 지도 영역 검색" → CCTV 선택 → 스냅샷.
   (업로드 탭: mp4/이미지. 등록 후 반복 재생되어 실시간처럼 동작하며 "전체 분석" 으로 영상 전체 시계열도 얻습니다.)
2. **도로 영역 지정** (픽셀 단위 편집기)
   - `SAM 점` 클릭(포함) / Shift+클릭(제외) → "점으로 추론", `SAM 박스` 드래그 → "박스로 추론", SAM3 가 있으면 `텍스트 "road"`
   - 노란 미리보기를 **현재 방향에 추가** 또는 **도로에서 제외**
   - 방향이 2개 이상이면(예: 서울 방면 / 수원 방면) `다각형` 으로 한쪽을 감싸 **"도로만 재할당"** 으로 방향을 나눔
   - `브러시`/`지우개` 로 픽셀 보정, `구멍 메우기`, `실행취소`
   - 마스크는 `data/cameras/{id}/road_mask.png` (0=도로 아님, 1..N=방향) 로 저장
3. **저장** 하면 워커가 시작되어 `INFER_FPS`(기본 2) 회/초 YOLO 추론 → 방향별 점유율 계산 → 5초 평균을 DB 에 기록.
4. 지도/전체 보기/통계/응용 페이지에서 확인. ITS URL 은 24시간만 유효하므로 워커가 만료 전 자동 재조회합니다.

## 점유율 계산 세부

- YOLO 인스턴스 마스크(`retina_masks`)를 프레임 크기 라벨맵(0/1=car/2=bus/3=truck)으로 합치고(겹침은 작은 객체 우선),
  `occupancy(d) = |vehicle ∩ road_d| / |road_d|`. `d=0` 은 모든 방향 합집합.
- 차량 대수는 인스턴스 무게중심이 속한 방향으로 셉니다. 차종별 대수·픽셀도 함께 기록되지만 차종 분류 정확도가 낮아 UI 에서 **차종 구분 모드**를 껐다 켤 수 있습니다.
- 분모(도로)는 차량이 덮을 수 있는 노면 전체여야 하므로, 등록 시 차량이 서 있는 자리까지 포함해서 칠하세요 (갓길·중앙분리대는 제외).
- 한계: 원근 때문에 화면 아래쪽 차량이 과대평가됩니다. 지점 간 절대 비교보다 같은 지점의 시간·방향 비교가 신뢰도가 높습니다.

## 주요 API

| 메서드 | 경로 | 설명 |
|---|---|---|
| GET | `/api/its/search?road_type&cctv_type&min_x&max_x&min_y&max_y` | ITS CCTV 목록 (서버가 키 보관) |
| POST | `/api/snapshots/from-source` · `/api/uploads` | 스냅샷 / 파일 업로드 |
| POST | `/api/segment/text` · `/api/segment/prompt` | SAM3 텍스트 / 점·박스 → 마스크 PNG(base64) |
| POST/GET | `/api/cameras` | 등록/목록 |
| PUT | `/api/cameras/{id}/mask` | 도로 라벨맵 + 방향 저장 (워커 재시작) |
| POST | `/api/cameras/{id}/start` · `/stop` · `/analyze` | 워커 제어, 업로드 영상 전체 분석 |
| GET | `/api/stream/{id}/mjpeg?mode=class|vehicle|road|none` | 실시간 세그멘테이션 MJPEG |
| GET | `/api/metrics/live` · `/history` · `/summary?by=route|region|section|camera` | 실시간/시계열/집계 |
| GET | `/api/metrics/timeline` · `/alerts` · `/heatmap` · `/history.csv` · `/summary.csv` | 지도 타임라인, 혼잡 경보 구간, 요일×시간, CSV |
| POST/GET | `/api/cameras/{id}/captures` | 현재 프레임+지표 저장/목록 |
| POST | `/api/system/demo` | 샘플 영상으로 데모 카메라 생성 |
| GET/POST | `/api/apps/groups` · `/api/apps/groups/{id}/report` · `/daily` | 응용 그룹 리포트, 일별 리포트, `/api/apps/presets/han-river` |

## 테스트

```bash
# 백엔드 단위 테스트 (점유율 계산, ITS 파싱, 임계값, 렌더링)
python -m pytest backend/tests -q

# 브라우저 E2E (서버가 떠 있어야 함; 설치된 Chrome 사용) — 업로드 → SAM 점 프롬프트 → 다각형/브러시 → 저장 → 상세
cd frontend && node e2e/register.mjs http://localhost:8000 ../data/uploads/sample_highway.mp4
```

## 알아둘 점

- **MPS(Apple GPU) 동시 추론 금지**: YOLO 워커와 SAM 요청이 동시에 GPU 를 쓰면 Metal 단언 실패로 프로세스가 죽습니다.
  `backend/app/ml/gpu.py` 의 전역 락으로 모든 추론을 직렬화합니다. 카메라가 많으면 `INFER_FPS` 를 낮추세요.
- **ITS URL**: 테스트 키로는 목록만 오고 영상(HLS)은 401 입니다. 정식 인증키를 `.env` 에 넣어야 실시간 영상이 열립니다.
  cctvType 1(http) 스트림은 https 로 배포한 페이지에서 hls.js 원본 재생이 막힐 수 있으므로 그 경우 4(https) 를 고르세요 (서버측 OpenCV 처리는 영향 없음).
- 샘플 데이터: `data/uploads/sample_highway.mp4` (AI-Hub 고속도로 CCTV 프레임을 5fps 로 이어 붙인 12초 클립). 지도 화면의 "샘플로 시작" 또는 `POST /api/system/demo` 로 데모 카메라를 만듭니다.
- **HLS 추론 주기**: ITS HLS 는 2초 세그먼트 단위로 프레임이 한꺼번에 도착하므로 시간이 아니라 프레임 개수 기준(`src_fps / INFER_FPS`)으로 추론 프레임을 고릅니다.
- **ITS 검색 범위**: 좁은 영역도 수백 개가 나오므로 지도 줌 10 이상에서만 자동 검색하고, 중심에서 가까운 400개만 표시합니다.
