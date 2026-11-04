export type TaskLink = { role?: string; phase?: string; profile?: string; workspace?: string; pane?: string; session?: string; native_user_id?: string | number; native_final_id?: string | number; aside_session_id?: string; sha256?: string; source_kind?: string }
export type TaskPhase = { phase: string; state: string; profile?: string; session?: string; session_id?: string; pane?: string; workspace?: string; aside_session_id?: string; user_id?: string | number; final_id?: string | number; sha256?: string }
export type TaskReport = {
  task_id: string; read_only: true; live_execution_enabled: false
  kind?: 'local_check' | 'public_research'; synthetic?: boolean
  phases: TaskPhase[]; links: TaskLink[]
  reviews: { revision?: string; claim_count?: number; decision?: string; synthetic?: boolean; reviewed_at?: string; reviewer_kind?: string }[]
  computed_verification: 'unverified' | 'synthetic_only'
  note: { task_id: string; status: string; hash_matches: boolean; relative_path?: string; sha256?: string; declared_verification?: string; source_count?: number }
}
