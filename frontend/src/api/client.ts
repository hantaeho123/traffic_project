/* 백엔드 REST 클라이언트.
 * - 개발/같은 서버 배포: VITE_API_BASE 비움 → 상대 경로 /api (Vite 가 8000 으로 프록시)
 * - 프론트만 Vercel 등 다른 곳에 배포: VITE_API_BASE=http://localhost:8000 또는 https://<터널/클라우드 주소>
 */
export const API_BASE: string = ((import.meta.env.VITE_API_BASE as string | undefined) ?? '').replace(/\/+$/, '')
export const apiUrl = (path: string) => `${API_BASE}${path}`


export interface Direction {
  id?: number
  index: number
  name: string
  color: string
}

export interface DirectionLive {
  direction_index: number
  name: string
  occupancy: number
  vehicle_px: number
  road_px: number
  n_vehicles: number
  counts: Record<string, number>
  class_px: Record<string, number>
  level: string | null
}

export interface LiveState {
  camera_id: number
  status: string
  error: string | null
  ts: string | null
  seq: number
  infer_ms: number
  fps: number
  video_time: number | null
  directions: DirectionLive[]
  name?: string
}

export interface Camera {
  id: number
  name: string
  source_type: 'its' | 'upload' | 'url'
  its_cctv_name: string | null
  its_road_type: string | null
  stream_url: string | null
  stream_url_fetched_at: string | null
  video_path: string | null
  lon: number | null
  lat: number | null
  route: string | null
  region: string | null
  section: string | null
  snapshot_path: string | null
  mask_path: string | null
  frame_width: number | null
  frame_height: number | null
  enabled: boolean
  meta: Record<string, unknown> | null
  created_at: string
  directions: Direction[]
  running: boolean
  live: LiveState | null
}

export interface ItsCctv {
  name: string
  lon: number
  lat: number
  url: string
  format: string | null
  cctvtype: string | null
  resolution: string | null
  road_type: string
  route: string | null
}

export interface LiveCamera {
  id: number
  name: string
  source_type: string
  lon: number | null
  lat: number | null
  route: string | null
  region: string | null
  section: string | null
  enabled: boolean
  has_mask: boolean
  directions: Direction[]
  running: boolean
  live: LiveState | null
  occupancy: number | null
  level: string | null
  n_vehicles: number | null
}

export interface LiveAll {
  thresholds: number[]
  levels: string[]
  cameras: LiveCamera[]
}

export interface HistoryPoint {
  t: string | number
  occupancy: number
  max: number
  n_vehicles: number
  n_car: number
  n_bus: number
  n_truck: number
  frames: number
  level: string | null
}

export interface MaskOut {
  mask_png_base64: string
  coverage: number
  width: number
  height: number
  backend: string
}

export interface Job {
  id: number
  camera_id: number
  status: string
  progress: number
  frame_stride: number
  started_at: string | null
  finished_at: string | null
  summary: Record<string, any> | null
  error: string | null
}

export interface Group {
  id: number
  name: string
  kind: string
  description: string | null
  created_at: string
  members: { id: number; camera_id: number; label: string | null; order: number; camera_name: string | null }[]
}

export class ApiError extends Error {
  status: number
  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}

async function req<T>(path: string, init?: RequestInit): Promise<T> {
  const r = await fetch(path, { headers: { 'Content-Type': 'application/json', ...(init?.headers || {}) }, ...init })
  if (!r.ok) {
    let msg = r.statusText
    try {
      const j = await r.json()
      msg = typeof j.detail === 'string' ? j.detail : JSON.stringify(j.detail ?? j)
    } catch {
      /* ignore */
    }
    throw new ApiError(r.status, msg)
  }
  if (r.status === 204) return undefined as T
  return (await r.json()) as T
}

const json = (body: unknown) => ({ body: JSON.stringify(body) })

export const api = {
  system: () => req<any>(apiUrl('/api/system/status')),
  its: {
    status: () => req<{ configured: boolean }>(apiUrl('/api/its/status')),
    search: (p: { road_type: string; cctv_type: string; min_x: number; max_x: number; min_y: number; max_y: number }) =>
      req<{ count: number; items: ItsCctv[] }>(apiUrl(`/api/its/search?` + new URLSearchParams(Object.fromEntries(Object.entries(p).map(([k, v]) => [k, String(v)])))),
      ),
  },
  snapshots: {
    fromSource: (source: string) =>
      req<{ snapshot_id: string; width: number; height: number; url: string }>(apiUrl('/api/snapshots/from-source'), { method: 'POST', ...json({ source }) }),
    upload: async (file: File) => {
      const fd = new FormData()
      fd.append('file', file)
      const r = await fetch(apiUrl('/api/uploads'), { method: 'POST', body: fd })
      if (!r.ok) throw new ApiError(r.status, (await r.json()).detail)
      return (await r.json()) as { kind: string; path: string; filename: string; snapshot_id: string; width: number; height: number; url: string; info: any }
    },
  },
  segment: {
    status: () => req<{ backend: string; text_prompt: boolean; point_prompt: boolean; box_prompt: boolean }>(apiUrl('/api/segment/status')),
    text: (b: { camera_id?: number; snapshot_id?: string; text: string; conf?: number }) => req<MaskOut>(apiUrl('/api/segment/text'), { method: 'POST', ...json(b) }),
    prompt: (b: { camera_id?: number; snapshot_id?: string; points?: number[][]; labels?: number[]; boxes?: number[][] }) =>
      req<MaskOut>(apiUrl('/api/segment/prompt'), { method: 'POST', ...json(b) }),
  },
  cameras: {
    list: () => req<Camera[]>(apiUrl('/api/cameras')),
    get: (id: number) => req<Camera>(apiUrl(`/api/cameras/${id}`)),
    create: (b: Record<string, unknown>) => req<Camera>(apiUrl('/api/cameras'), { method: 'POST', ...json(b) }),
    update: (id: number, b: Record<string, unknown>) => req<Camera>(apiUrl(`/api/cameras/${id}`), { method: 'PATCH', ...json(b) }),
    remove: (id: number) => req<void>(apiUrl(`/api/cameras/${id}`), { method: 'DELETE' }),
    putMask: (id: number, mask_png_base64: string, directions: Direction[]) =>
      req<Camera>(apiUrl(`/api/cameras/${id}/mask`), { method: 'PUT', ...json({ mask_png_base64, directions }) }),
    start: (id: number) => req<Camera>(apiUrl(`/api/cameras/${id}/start`), { method: 'POST' }),
    stop: (id: number) => req<Camera>(apiUrl(`/api/cameras/${id}/stop`), { method: 'POST' }),
    refreshSnapshot: (id: number) => req<Camera>(apiUrl(`/api/cameras/${id}/snapshot`), { method: 'POST' }),
    analyze: (id: number, stride = 5) => req<Job>(apiUrl(`/api/cameras/${id}/analyze?frame_stride=${stride}`), { method: 'POST' }),
    jobs: (id: number) => req<Job[]>(apiUrl(`/api/cameras/${id}/jobs`)),
    clearSamples: (id: number, source?: string) => req<void>(apiUrl(`/api/cameras/${id}/samples${source ? `?source=${source}` : ''}`), { method: 'DELETE' }),
  },
  stream: {
    live: (id: number) => req<LiveState>(apiUrl(`/api/stream/${id}/live`)),
    frameUrl: (id: number, mode: string, hud = true) => `${API_BASE}/api/stream/${id}/frame.jpg?mode=${mode}&hud=${hud}&_=${Date.now()}`,
    mjpegUrl: (id: number, mode: string, hud = true, maxFps = 8) => `${API_BASE}/api/stream/${id}/mjpeg?mode=${mode}&hud=${hud}&max_fps=${maxFps}`,
  },
  metrics: {
    live: () => req<LiveAll>(apiUrl('/api/metrics/live')),
    history: (p: { camera_id: number; direction?: number; minutes?: number; bucket?: number; source?: string }) =>
      req<{ points: HistoryPoint[]; source: string }>(apiUrl(`/api/metrics/history?` + new URLSearchParams(Object.fromEntries(Object.entries(p).filter(([, v]) => v != null).map(([k, v]) => [k, String(v)])))),
      ),
    summary: (by: string, minutes: number) => req<any>(apiUrl(`/api/metrics/summary?by=${by}&minutes=${minutes}`)),
  },
  apps: {
    hanRiver: () => req<{ name: string; bridges: { name: string; lat: number; lon: number }[] }>(apiUrl('/api/apps/presets/han-river')),
    groups: () => req<Group[]>(apiUrl('/api/apps/groups')),
    group: (id: number) => req<Group>(apiUrl(`/api/apps/groups/${id}`)),
    createGroup: (b: Record<string, unknown>) => req<Group>(apiUrl('/api/apps/groups'), { method: 'POST', ...json(b) }),
    updateGroup: (id: number, b: Record<string, unknown>) => req<Group>(apiUrl(`/api/apps/groups/${id}`), { method: 'PATCH', ...json(b) }),
    deleteGroup: (id: number) => req<void>(apiUrl(`/api/apps/groups/${id}`), { method: 'DELETE' }),
    report: (id: number, minutes: number, bucket = 300) => req<any>(apiUrl(`/api/apps/groups/${id}/report?minutes=${minutes}&bucket=${bucket}`)),
  },
}
