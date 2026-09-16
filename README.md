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
| `/` 지도 | 등록 CCTV 를 지도에 혼잡 단계 색으로 표시. 클릭하면 실시간 세그멘테이션 영상과 방향별 점유율 |
| `/register` CCTV 등록 | ① ITS 검색(지도 영역)/업로드/URL → ② SAM3·브러시로 도로 영역과 **방향** 지정 → ③ 이름·노선·지역·구간 저장 |
| `/cameras` 전체 보기 | 모든 CCTV 의 실시간 세그멘테이션 스트림을 격자로. **차종 구분 모드 / 차량 단일 모드** 전환 |
| `/cameras/:id` 상세 | 큰 실시간 화면(차종별·단일·도로만·원본), 방향별 게이지, 점유율 추이 차트, 마스크 재편집, 업로드 영상 전체 분석, 원본 HLS |
| `/stats` 점유율 통계 | 노선별 / 지역별 / 구간별 / 카메라별 최근 N분 평균 점유율 (방향별 포함) |
| `/apps` 응용 분석 | CCTV 그룹 리포트. 프리셋 **한강 대교**: 교량별 점유율 비교, 방향 불균형, 시간대 프로필, 자동 정책 인사이트 |
| `/system` 시스템 | 모델/ITS 키/임계값/워커 상태 |

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
# 1) 파이썬 가상환경 + 패키지 + .env + DB + 프론트 패키지
bash scripts/setup.sh
#    (이미 torch/ultralytics 가 있는 conda 환경을 쓰려면: PYTHON=/opt/anaconda3/envs/VITA/bin/python 로 실행하거나
#     그 환경에 `pip install -r requirements.txt` 만 하면 됩니다)

# 2) .env 채우기
#    ITS_API_KEY=...            국가교통정보센터에서 발급 (https://www.its.go.kr/opendata/opendataList?service=cctv)
#    DATABASE_URL=postgresql+psycopg://localhost:5433/traffic

# 3) 모델 가중치
#    models/weights/yolov8s_seg_vehicle.pt   ← 파인튜닝 결과 best.pt 복사 (.env YOLO_WEIGHTS)
#    models/weights/sam3.pt                  ← python scripts/download_sam3.py --token hf_xxx
#    sam3.pt 가 없으면 SAM2.1 로 자동 대체됩니다 (점/박스 프롬프트만 가능, 텍스트 "road" 프롬프트 불가).
```

### PostgreSQL

macOS(Homebrew): `brew install postgresql@17 && brew services start postgresql@17`, 이후 `bash scripts/init_db.sh` 가 `DATABASE_URL` 의 DB 를 만듭니다.
이 저장소는 5432 에 다른 PostgreSQL(18, EDB 설치본)이 떠 있는 환경이라 **Homebrew 17 을 5433 포트**로 씁니다
(`/opt/homebrew/var/postgresql@17/postgresql.conf` 의 `port = 5433`). 기존 서버를 쓰려면 `DATABASE_URL` 만 바꾸면 됩니다. 테이블은 서버 시작 시 자동 생성됩니다.

## 실행

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
     - 다른 사람도 보게 하려면 백엔드를 터널로 노출: `brew install cloudflared && cloudflared tunnel --url http://localhost:8000` → 출력된 `https://xxxx.trycloudflare.com` 을 `VITE_API_BASE` 로. (ngrok 도 동일)
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
| GET/POST | `/api/apps/groups` · `/api/apps/groups/{id}/report` | 응용 그룹 리포트, `/api/apps/presets/han-river` |

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
- 샘플 데이터: `data/uploads/sample_highway.mp4` (AI-Hub 고속도로 CCTV 프레임을 5fps 로 이어 붙인 12초 클립).
