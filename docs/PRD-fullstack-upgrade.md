# PRD · Agent OS 풀스택 개선 (0.1.3 → 0.2.0)

- 작성일: 2026-11-10
- 대상: `apps/desktop` (Electron main · preload · React renderer · Rust/Swift/Python 헬퍼), `coordination/`, `ops/macos/`, 빌드·패키징 스크립트
- 기준 커밋: `168bdb6` (main, clean)
- 상태: 범위 확정 (2026-11-10 결정 사항 §8 반영) — 요구사항 19건

---

## 1. 배경과 점검 결과

Agent OS는 기존 Giselle(Hermes) 프로필을 유일한 실행 경로로 쓰는 보호형 macOS 데스크톱이다. 렌더러는 sandbox + context isolation + CSP(`connect-src 'none'`)로 격리되어 있고, 모든 기능은 발신자 검증 IPC를 거친다. 안전 경계는 잘 설계되어 있고 테스트로 고정되어 있다.

### 1.1 현재 상태 (2026-11-10 실측)

| 항목 | 결과 |
|---|---|
| `npm run typecheck` | 통과 (renderer + electron 두 설정 모두) |
| `npm test` | 30 파일 · 312 테스트 통과 (20.5초) |
| `npm run test:coordination` | 77 테스트 통과 |
| `npm run test:services` | 7 테스트 통과 |
| `npm audit --omit=dev` | 취약점 0 |
| 코드 규모 | 약 1만 줄 / 713KB (TS·TSX·Python·Rust·Swift·CSS) |
| CI | 없음 (`.github/` 없음) |
| 린터·포매터 | 없음 (ESLint·Prettier·Biome·ruff 설정 없음) |
| 렌더러 번들 | JS 646KB 단일 청크, CSS 45.8KB |

즉 **기능 정확성은 양호**하다. 개선 여지는 정확성이 아니라 ① 유지보수성, ② 응답성, ③ 자동화, ④ 사용성에 몰려 있다.

### 1.2 핵심 발견

| # | 발견 | 근거 |
|---|---|---|
| F1 | 렌더러 최상위 컴포넌트가 676줄 단일 함수, `useState` 36개 | `apps/desktop/src/protected/Desktop.tsx:28-703` |
| F2 | 줄 압축형 코드. 한 줄에 메서드 하나가 통째로 들어가 diff·리뷰·디버깅이 어렵다 | `apps/desktop/protected/vault.ts` (18KB가 51줄), `VaultPane.test.ts` (한 줄 1,500자 이상) |
| F3 | 실행 상태를 500ms 간격 IPC 폴링으로 읽음. 터미널은 이미 push 이벤트 사용 | `Desktop.tsx:234`, `DiscoveryFollowup.tsx:41` vs `preload.ts`의 `terminal.onEvent` |
| F4 | main 프로세스 동기 파일 IO. 히스토리 조회 시 파일마다 `lstatSync`·`statSync`를 정렬 비교 안에서 반복 호출 | `acp-ledger.ts:117-124` (파일 내 `*Sync` 34회), `sessions.ts` 7회, `vault-results.ts` 8회 |
| F5 | `HermesCli.request`가 275줄 단일 메서드 (검증·spawn·스트림 파싱·타임아웃·정산 혼재) | `hermes-cli.ts:67-342` |
| F6 | 사용자 환경 하드코딩: 볼트 경로, Hermes 경로, node 경로 | `main.ts:34` (`~/Desktop/Obsidian-Syncthing/MyObsidianVault`), `hermes-cli.ts:129`, `main.ts:90,114` |
| F7 | 준비된 요청이 메모리에만 있고 200개 도달 시 "앱 재시작" 요구 | `main.ts:228` |
| F8 | IPC 핸들러 인자가 `any[]`, 검증이 핸들러마다 수작업 | `main.ts:150` |
| F9 | Hermes 자식 프로세스에 `process.env` 전체 전달. 다른 spawn은 최소 env 사용 | `hermes-cli.ts:135` vs `main.ts:118` |
| F10 | 결과가 `<pre>` 평문. 마크다운·코드블록 렌더링 없음 | `Result.tsx:42` |
| F11 | React ErrorBoundary 없음. 렌더 예외 시 빈 화면 | `src/main.tsx`, `src/` 전체 검색 0건 |
| F12 | `styles.css`의 최상위 클래스 34개가 TSX에서 한 번도 참조되지 않음 (업스트림 Herald OS 잔재 추정: `.dock-bar`, `.glass-card`, `.boot-leave` 등) | `apps/desktop/src/styles.css` (735줄, 18KB) |
| F13 | 동일 파일 중복 | `apps/desktop/protected/task_report.py` ≡ `coordination/helper/task_report.py` (`diff` 일치) |
| F14 | 패키징 스크립트에 버전·아키텍처 하드코딩, 서명·공증·자동 업데이트 없음 | `scripts/package-protected.mjs:17,25`, `build/protected.json` |
| F15 | 문서 경로 불일치: README는 `cd apps/agent-os`를 안내하지만 실제 워크스페이스는 `apps/desktop` | `README.md:14` |
| F16 | fixture 전송 모드가 있으나 이를 쓰는 자동 E2E가 없음. GUI 검증은 수동 기록 | `main.ts:29-31`, `VERIFICATION.md:25` |
| F17 | Rust Office 리더 단위 테스트 2개뿐 (371줄, 신뢰 경계의 파서) | `native/office-reader/src/main.rs` |
| F18 | 키보드 단축키가 사실상 없음 (Escape, 터미널 분할선 화살표뿐) | `Result.tsx:46`, `TerminalWorkspace.tsx:79` |
| F19 | 볼트 검색이 매 질의마다 범위 전체를 다시 읽음 (최대 3,000 노트 / 32MiB / 2초) | `vault.ts:26-35` |
| F20 | 의존성 메이저 뒤처짐: Electron 44→45, TypeScript 6→7, jsdom 27→29 | `npm outdated` |

---

## 2. 목표와 비목표

### 목표

1. 안전 경계를 **하나도 약화시키지 않고** 유지보수 비용을 낮춘다.
2. 요청 실행 중 체감 응답성을 높인다 (폴링 제거, main 스레드 블로킹 제거).
3. 사람이 기억해야 하는 검증을 CI로 옮긴다.
4. 매일 쓰는 흐름(요청 → 결과 → 볼트)의 사용성을 높인다.

### 비목표 (하지 않는다)

- 다중 에이전트·다중 프로필 지원, 동시 요청 실행. 현재 "단일 요청" 정책은 의도된 안전 경계다.
- Windows·Linux 지원. `sandbox-exec`, PDFKit/Vision, LaunchAgent에 의존한다.
- 렌더러의 네트워크 허용, 임의 셸·파일 접근 확대.
- Hermes 설치·로그인·자격증명 관리.
- 상태 관리 라이브러리(Redux·Zustand 등) 도입. `useReducer`로 충분하다.
- 자동 재전송. 현재 "알 수 없는 결과는 재시도하지 않는다" 원칙을 유지한다.

### 공통 제약 (모든 항목에 적용)

- 기존 312 + 77 + 7개 테스트는 **수정 없이** 통과해야 한다. 포매팅만 바뀌는 경우는 예외.
- 새 IPC 채널은 `trusted()` 발신자 검증을 거친다.
- `VERIFICATION.md`에 항목별 검증 기록을 추가한다.

---

## 3. 요구사항

우선순위: **P0** = 다른 작업의 전제 / **P1** = 사용자 체감 가치 큼 / **P2** = 있으면 좋음.
규모: S = 반나절 이하, M = 1~2일, L = 3일 이상.

### P0 — 기반

#### R1. 포매터·린터 도입과 압축형 코드 풀기 (F2) · M

- **요구**: Biome 하나만 도입한다(포맷 + 린트, 설정 파일 1개). 현재 스타일(세미콜론 없음, 작은따옴표)을 유지한다. Python은 `ruff format` + `ruff check`. 루트 스크립트 `npm run lint`, `npm run format` 추가.
- **절차**: ① 설정만 추가하는 커밋 → ② 포맷만 적용하는 커밋(로직 변경 0) → ③ `.git-blame-ignore-revs`에 ②의 해시 등록.
- **수용 기준**
  - `npm run lint`가 0 에러로 끝난다.
  - 포맷 커밋 전후 `npm run build` 산출물의 동작이 같다 (전체 테스트 통과).
  - 120자를 넘는 줄이 소스에 없다 (문자열 리터럴 예외).
- **주의**: 소스 문자열을 `readFileSync`로 읽어 검사하는 테스트가 있다(`protection.test.ts`, `sandbox.test.ts` 등). 포맷 후 깨지면 테스트의 매칭 문자열만 고친다.

#### R2. CI 파이프라인 (점검 결과 "CI 없음") · S

- **요구**: `.github/workflows/ci.yml` 1개. `macos-latest`에서 `npm ci` → `lint` → `typecheck` → `test` → `test:coordination` → `test:services` → `cargo test` → `npm run build`.
- **수용 기준**
  - PR과 main push에서 실행된다.
  - npm·cargo 캐시 적용.
  - `npm audit --omit=dev --audit-level=high`, `cargo audit` 실패 시 빌드 실패.
- **건너뜀**: 릴리스 자동화, 매트릭스 빌드. R13에서 다룬다.

#### R3. 문서 경로 수정과 중복 제거 (F13, F15) · S

- **요구**
  - `README.md:14`의 `cd apps/agent-os`를 실제 구조에 맞게 고친다.
  - `task_report.py`는 한 곳만 원본으로 두고, 다른 쪽은 빌드/설치 시 복사한다. 최소한 두 파일이 같은지 확인하는 테스트 1개를 둔다.
- **수용 기준**: README 명령을 새 클론에서 그대로 실행하면 앱이 뜬다. 두 파일이 달라지면 테스트가 실패한다.

### P1 — 구조와 응답성

#### R4. `ProtectedDesktop` 분해 (F1) · L

- **요구**: 동작 변경 없이 676줄 함수를 나눈다.
  - 훅 추출: `useAttachments`, `useSubmission`(prepare/request/cancel/상태), `useConversations`, `useProfile`.
  - 서로 얽힌 제출 상태(`idle → preparing → running → completed/failed/unknown`)는 `useReducer` 하나로 모은다. 불가능한 상태 조합을 타입으로 막는다.
  - 화면 조각: `Composer`, `AttachmentTray`, `ConversationList`, `StatusBanner`.
- **수용 기준**
  - `Desktop.tsx`가 250줄 이하.
  - `Desktop.test.ts` 475줄이 **수정 없이** 통과한다 (리팩터링 안전망).
  - 최상위 `useState`가 10개 이하.
- **건너뜀**: 전역 스토어, 라우터.

#### R5. `HermesCli.request` 분해 (F5) · M

- **요구**: 275줄 메서드를 단계별 private 메서드로 나눈다 — `validateWork` → `claim` → `launch` → `consumeStream` → `settle`. 스트림 파서는 순수 함수로 분리해 child 없이 테스트한다.
- **수용 기준**
  - 어떤 메서드도 80줄을 넘지 않는다.
  - `hermes-cli.test.js`, `hermes-delegation-stream.test.ts`, `submission-flow.test.ts`가 수정 없이 통과한다.
  - 스트림 파서 단위 테스트 추가: 잘린 JSON 줄, 한도 초과 바이트, 순서가 뒤바뀐 이벤트.

#### R6. 상태 폴링을 push 이벤트로 교체 (F3) · M

- **현재**: 렌더러가 500ms마다 `protected:request {action:'status'}`를 호출한다.
- **요구**: 터미널과 같은 패턴으로 `protected:hermes-event` 채널을 추가한다. main이 상태가 바뀔 때만 `HermesState`를 보낸다. `preload`에 `onHermesEvent(listener)`를 노출하고 해제 함수를 반환한다.
- **유지**: `status` 요청은 그대로 둔다 (재시작 후 복구, 이벤트 유실 시 1회 재조정). `StatusPoller`의 "미해결 조회 최대 1건" 보장도 그대로다.
- **수용 기준**
  - 실행 중 IPC 호출이 초당 2회에서 상태 변화 횟수로 줄어든다.
  - 응답 델타가 500ms 지연 없이 화면에 나타난다.
  - 다른 work의 이벤트·언마운트 후 도착한 이벤트는 버린다 (기존 테스트 시나리오를 이벤트 버전으로 추가).
  - 이벤트는 메인 프레임에만, 예상 URL일 때만 보낸다 (`main.ts`의 터미널 송신 조건과 동일).

#### R7. main 프로세스 동기 IO 제거 (F4) · M

- **요구**
  - `FileAcpLedger.recentKeys()`: 정렬 비교 함수 안의 `statSync` 호출을 없앤다. 파일마다 stat을 한 번만 읽고 정렬한다.
  - `protected:history`는 50개 work를 매번 디스크에서 읽지 않도록 mtime 기준 메모리 캐시를 둔다.
  - 읽기 경로는 `fs/promises`로 옮긴다. **쓰기 경로의 원자성(임시 파일 → fsync → rename → 디렉터리 fsync)은 그대로 둔다.** `claim()`의 배타 생성 의미도 바꾸지 않는다.
- **수용 기준**
  - 원장 파일 50개 기준 `history` 응답이 10ms 이하 (캐시 적중 시).
  - `sessions.test.ts`, `submission-flow.test.ts` 통과.
- **건너뜀**: SQLite 이전. 파일 50개 규모에서는 불필요하다.

#### R8. ~~설정 가능한 경로 (F6)~~ — 삭제

본인 Mac 전용 앱이므로 볼트·Hermes 경로 하드코딩을 유지한다 (§8 결정 1). 번호는 다른 항목 참조를 위해 비워 둔다.

#### R9. 준비 요청 한도 해소 (F7) · S

- **요구**: `prepared`·`works` 맵에서 정산이 끝난(원장에 기록된) 항목과 폐기된 항목을 제거한다. 200개 한도는 "미정산 건수" 기준으로 바꾼다.
- **수용 기준**: 요청 300건을 순차 처리해도 "restart the app" 오류가 나지 않는다 (단위 테스트). 같은 `requestId` 재사용 시 충돌 감지는 유지된다.

#### R10. 결과 마크다운 렌더링 (F10) · M

- **요구**: 결과 본문을 마크다운으로 렌더링한다 — 제목, 목록, 코드블록, 표, 굵게·기울임.
- **보안 요구 (필수)**
  - 원시 HTML 비활성화. `dangerouslySetInnerHTML` 사용 금지 — React 엘리먼트로만 렌더링한다.
  - 링크는 클릭 불가 텍스트로 표시한다 (현재 `will-navigate`·`setWindowOpenHandler` 차단과 일치).
  - 이미지 문법은 렌더링하지 않는다 (CSP `img-src`가 원격을 막지만 명시적으로 거부).
- **유지**: "원문 보기" 전환, 선택 복사, 숨김은 원문 텍스트 기준으로 동작한다 (`result-controls.ts`의 해시가 원문 기준이다).
- **수용 기준**
  - `<script>`, `<img onerror>`, `javascript:` 링크가 든 입력이 텍스트로만 표시된다 (테스트).
  - `Result.test.ts` 통과.
- **구현 방식**: 자체 최소 파서(약 150줄, 순수 함수 `markdown → React 엘리먼트`). 새 의존성을 추가하지 않는다. 지원 문법 밖의 입력은 평문으로 표시한다. 파서 단위 테스트를 둔다 (중첩 목록, 닫히지 않은 코드블록, 열 수가 맞지 않는 표).

#### R11. ErrorBoundary (F11) · S

- **요구**: 루트에 ErrorBoundary 1개. 대체 화면에 "다시 불러오기" 버튼과 "동일 요청을 재전송하지 마세요" 안내를 둔다. 실행 중이던 work ID 표시는 하지 않는다 — 경계가 `ProtectedDesktop` 바깥에 있어 ID를 알 수 없다. 대신 "다시 불러온 뒤 활동 기록에서 확인" 안내를 둔다 (2단계 구현 시 결정).
- **수용 기준**: 자식 컴포넌트가 throw해도 빈 화면이 아니라 대체 화면이 보인다 (테스트 1개).

### P2 — 다듬기

#### R12. IPC 입력 검증 일원화 (F8) · M

- **요구**: 핸들러 등록 시 채널별 검증 함수를 함께 넘긴다 — `handle(channel, validate, fn)`. `fn`의 인자 타입을 검증 결과에서 추론해 `any[]`를 없앤다. 검증기는 직접 작성한다(이미 `terminalSize`, `attachmentIds`, `hermesRoute` 같은 함수가 있으므로 그 패턴을 따른다).
- **수용 기준**: `main.ts`에 `any`가 없다. 채널마다 잘못된 인자 거부 테스트가 있다.
- **건너뜀**: zod 등 스키마 라이브러리. 채널이 25개 수준이라 불필요하다.

#### R13. 패키징 하드코딩 제거 (F14) · S

- **요구**
  - 버전은 `package.json`에서 읽는다 (`scripts/package-protected.mjs:25`의 `'0.1.3'` 제거).
  - 아키텍처는 `process.arch`에서 가져온다 (`darwin-arm64` 하드코딩 제거).
- **수용 기준**: `npm version patch` 후 패키징하면 번들 버전이 따라온다.
- **건너뜀**: 서명·공증·자동 업데이트. 미서명 로컬 번들을 유지한다 (§8 결정 4).

#### R14. fixture 모드 기반 E2E 스모크 (F16) · M

- **요구**: 이미 있는 `HERALD_TEST_TRANSPORT` fixture 전송을 Playwright의 Electron 드라이버로 구동하는 스모크 테스트 3개.
  1. 앱 시작 → 진단 "ready" 표시
  2. 요청 입력 → 전송 → fixture 응답 표시
  3. 실행 중 취소 → "unknown/중단" 상태 표시, 재전송 버튼 없음
- **수용 기준**: `npm run test:e2e`가 로컬과 CI(macOS)에서 통과한다. 사용자 실제 프로필·볼트를 건드리지 않는다 (`.local` 분리 데이터).
- **함께 확인**: fixture 모드가 패키징된 앱에서도 환경변수만으로 켜지는지 확인하고, 켜진다면 `!app.isPackaged`로 막는다 (`main.ts:29`).

#### R15. Office 리더 테스트 보강 (F17) · M

- **요구**: 거부 경로 테스트를 추가한다 — zip bomb(압축률 한도), 중첩 깊이 초과, 암호화 문서, 매크로 포함(`vbaProject.bin`), 경로 순회 엔트리 이름(`../`), 잘린 XML. `cargo fuzz` 타깃 1개(입력 바이트 → 패닉 없음).
- **수용 기준**: `cargo test`가 10개 이상 거부 케이스를 다룬다. fuzz 10분 실행에 패닉 0.

#### R16. Hermes 자식 프로세스 환경 최소화 (F9) · S

- **요구**: `...process.env` 대신 허용 목록으로 구성한다. 먼저 Hermes CLI가 실제로 필요한 변수(`HOME`, `PATH`, `HERMES_HOME`, 로케일, 프록시 등)를 확인한 뒤 목록을 정한다.
- **수용 기준**: 허용 목록 밖의 변수가 자식에 전달되지 않는다 (테스트). 실제 Giselle 요청 1건이 성공한다 (수동 검증, `VERIFICATION.md` 기록).
- **위험**: 인증이 환경변수에 의존하면 요청이 깨진다. 반드시 수동 검증 후 병합.

#### R17. 미사용 CSS 정리와 번들 축소 (F12) · S

- **요구**: `styles.css`에서 참조 없는 34개 클래스를 지운다. 지우기 전에 클래스명이 문자열 조합으로 생성되는 곳이 없는지 확인한다. xterm은 터미널 패널을 처음 열 때 동적 import한다.
- **수용 기준**: 초기 JS 청크 450KB 이하. 화면 비교(800×600, 1320×860)에서 차이 없음.

#### R18. 키보드 단축키 (F18) · S

- **요구**: `Cmd+Enter` 전송, `Cmd+N` 새 대화, `Cmd+.` 중단, `Cmd+K` 볼트 검색 포커스, `` Ctrl+` `` 터미널 접기. 터미널에 포커스가 있을 때는 터미널 입력이 우선한다.
- **수용 기준**: 각 단축키가 해당 버튼의 `disabled` 상태를 그대로 따른다 (비활성일 때 동작하지 않음). 단축키는 버튼 `title`에 표시한다.

#### R19. 볼트 검색 캐시 (F19) · M — **측정 후 결정**

- **요구**: 먼저 실제 볼트에서 검색 시간을 잰다. 중앙값이 300ms를 넘을 때만 진행한다.
- **진행 시**: 경로별 `(mtime, size)` → 메타데이터(제목·태그·토픽) 메모리 캐시. 본문은 캐시하지 않는다 (32MiB 상한 유지, 메모리 사용 억제).
- **수용 기준**: 변경 없는 볼트에서 두 번째 검색이 첫 번째의 절반 이하 시간. 노트 수정 후 검색 결과가 즉시 반영된다.
- **건너뜀**: 전문 검색 인덱스(FTS). 3,000 노트 상한에서는 과하다.

#### R20. 의존성 업그레이드 (F20) · S~M

- **요구**: CI(R2)가 들어간 뒤 진행한다. 패치·마이너는 한 번에, 메이저는 하나씩 별도 PR.
  - Electron 44 → 45: sandbox, `senderFrame`, `mainFrame.send` 동작 확인
  - TypeScript 6 → 7: 두 tsconfig 모두 통과 확인
  - jsdom 27 → 29: 렌더러 테스트 통과 확인
- **수용 기준**: 메이저마다 전체 테스트 + R14 스모크 통과.

---

## 4. 구현 순서

```
1단계 (기반)      R3 → R2 → R1
2단계 (구조)      R5 → R4 → R11
3단계 (응답성)    R7 → R6 → R9
4단계 (사용성)    R10 → R18
5단계 (다듬기)    R14 → R12 → R16 → R15 → R17 → R13 → R20 → R19(측정 결과에 따라)
```

순서의 이유:

- R2(CI)와 R1(포맷)이 먼저 있어야 이후 리팩터링 diff를 읽을 수 있다.
- R4·R5(분해)는 R6(push 이벤트)보다 먼저 한다. 676줄·275줄 함수에 이벤트 경로를 추가하면 더 얽힌다.
- R14(E2E)는 R20(메이저 업그레이드)의 안전망이다.

---

## 5. 성공 지표

| 지표 | 현재 | 목표 |
|---|---|---|
| `Desktop.tsx` 최대 함수 길이 | 676줄 | 250줄 이하 |
| `HermesCli` 최대 메서드 길이 | 275줄 | 80줄 이하 |
| 실행 중 상태 IPC 호출 | 초당 2회 고정 | 상태 변화 시에만 |
| 응답 델타 표시 지연 | 최대 500ms | 100ms 이하 |
| 초기 렌더러 JS | 646KB | 450KB 이하 |
| CI 검증 | 없음 | lint·typecheck·test 4종·build 자동 |
| GUI 자동 검증 | 0건 | 스모크 3건 |
| 120자 초과 소스 줄 | 다수 | 0 |
| 기존 테스트 | 396건 통과 | 396건 통과 유지 + 신규 |

---

## 6. 위험과 완화

| 위험 | 영향 | 완화 |
|---|---|---|
| 포맷 커밋이 소스 문자열 검사 테스트를 깨뜨림 | R1 지연 | 포맷과 테스트 수정을 같은 PR에서, 로직 변경과는 분리 |
| push 이벤트 유실로 화면이 "running"에 멈춤 | 사용자가 결과를 못 봄 | `status` 조회를 유지하고, 이벤트 무수신 5초 시 1회 재조정 |
| 리팩터링 중 "재전송 금지" 불변식 훼손 | 중복 요청·과금 | `submission-flow.test.ts`, `preparation.test.ts`를 수정 금지 안전망으로 지정 |
| env 최소화로 Hermes 인증 실패 | 실제 요청 불가 | R16은 수동 실요청 검증 후에만 병합, 문제 시 즉시 되돌림 |
| 마크다운 렌더링이 주입 경로를 엶 | 렌더러 신뢰 경계 약화 | HTML 비활성화, 링크 비활성화, 주입 테스트 필수 |
| 원장 비동기화로 `claim` 경쟁 조건 발생 | 중복 실행 | 쓰기·claim 경로는 동기 그대로 두고 읽기만 옮김 |

---

## 7. 범위 밖 (검토했으나 제외)

| 항목 | 제외 이유 |
|---|---|
| 상태 관리 라이브러리 | `useReducer`로 해결되는 규모 |
| SQLite 원장 | 파일 50개 규모, 현재 원자적 쓰기로 충분 |
| 스키마 검증 라이브러리 | IPC 채널 25개 수준, 기존 수작업 검증 패턴으로 충분 |
| i18n 프레임워크 | 한국어 단일 사용자. 필요해지면 문자열 추출부터 |
| 라이트 테마 | 요청 없음 |
| 볼트·Hermes 경로 설정 (구 R8) | 본인 Mac 전용, 하드코딩으로 충분 |
| `react-markdown` | 필요한 문법이 좁음, 자체 최소 파서로 대체 |
| 서명·공증 | 로컬 사용, 미서명 번들 유지 |
| 자동 업데이트 | 네트워크 차단 원칙과 충돌 |
| 동시 요청·다중 프로필 | 의도된 안전 경계 |

---

## 8. 결정 사항 (2026-11-10)

| # | 질문 | 결정 | 영향 |
|---|---|---|---|
| 1 | 볼트 경로를 설정 가능하게 할 것인가 | 하드코딩 유지 | R8 삭제 |
| 2 | 포매터·린터 | Biome + ruff | R1 확정 |
| 3 | 마크다운 렌더링 방식 | 자체 최소 파서 | R10 확정, 새 의존성 없음 |
| 4 | 서명·공증·자동 업데이트 | 하드코딩 제거만 | R13 규모 M → S |

### 기본값으로 진행하는 항목 (이견 있으면 알려 주세요)

- **R16 환경변수 목록**: 사전에 묻지 않고 R16 작업의 첫 단계에서 Hermes CLI 소스·문서로 확인한다. 확인이 안 되면 R16은 보류한다.
- **`coordination/`·`ops/macos/` 범위**: R2(CI 포함)와 R3(중복 제거) 외에는 건드리지 않는다.

---

## 부록 A. 점검 방법

- 구조: `graft map`, 모듈별 `graft skeleton`
- 정적 지표: `wc`, `grep`으로 `useState`·`*Sync(`·`setInterval`·`any` 집계
- 실행 검증: `npm run typecheck`, `npm test`, `npm run test:coordination`, `npm run test:services`, `npm audit --omit=dev`, `npm outdated`
- 직접 읽은 파일: `main.ts` 전체, `preload.ts`, `types.ts`, `hermes-cli.ts:67-165`, `acp-ledger.ts:117-124`, `vault.ts:24-36`, `Result.tsx` 앞부분, `Desktop.test.ts` 앞부분, `index.html`, 설정 파일 일체
- **읽지 않은 부분**: Python 헬퍼(`vault-query.py`, `sessions.py`, `admission.py` 등)와 `coordination/helper/*`의 내부 로직, Swift 리더, `Discovery*.tsx` 본문은 골격·크기만 확인했다. 이 영역의 세부 결함은 본 PRD에 반영되지 않았다.
- **확인이 더 필요한 발견**: F12(미사용 CSS)는 TSX 내 문자열 검색 기준이다. 동적 조합 클래스가 있으면 달라진다. R14의 "패키징 앱에서 fixture 모드 활성화 가능 여부"는 코드상 추정이며 실행으로 확인하지 않았다.

---

## 부록 B. 5단계 구현 결과와 PRD 편차 (2026-11-10)

| 항목 | 상태 | 비고 |
|---|---|---|
| R14 E2E 스모크 | 완료 | `npm run test:e2e` (playwright-core, 별도 vitest 설정). 3건 + 실제 xterm 청크 로드 확인. 패키징 앱에서의 fixture 모드는 문서화된 검증 경로(`runtime-paths.ts`, `VERIFICATION.md`)라 `!app.isPackaged`로 막지 않았다. |
| R12 IPC 인자 검증 | 완료 | `ipc-args.ts`의 채널별 인자 규칙. `main.ts`의 `any` 제거. 값 자체의 검증은 소비 모듈이 계속 담당. |
| R16 Hermes env 최소화 | **보류** | Hermes가 읽는 환경변수가 700개 이상이고 도구별 API 키도 포함되어 허용 목록을 정적으로 도출할 수 없다. 실제 Giselle 요청으로 검증해야 하며 외부 모델 비용이 든다. |
| R15 Office 리더 테스트 | 완료 | 거부 경로 17건 + 변형 입력 3,000회. `cargo-fuzz`는 nightly가 필요해 결정적 변형 테스트로 대체. **테스트가 스택 오버플로 결함을 발견**해 XML 깊이 한도(256)를 추가. |
| R17 CSS·번들 | 완료 | 미참조 규칙 80개·keyframes 9개 제거, xterm 동적 import. 초기 JS 676KB → 345KB. 화면 비교 수행: 변경 전 커밋(168bdb6)과 6개 화면(빈 채팅·응답·앱·볼트·활동·문제 발견) × 2개 창 크기(1320×860, 800×600)를 픽셀 비교해 차이 없음(활동 기록은 실행마다 달라지는 fixture 세션 ID 한 줄만 다름). |
| R13 패키징 | 완료 | 버전·node-pty 버전·아키텍처를 하드코딩하지 않음. 번들 버전 0.1.3 확인. |
| R20 의존성 | 완료 | 패치·마이너 일괄, Electron 44→45.2.3, TypeScript 6→7.0.2, jsdom 27→29.1.1. `@types/node`는 엔진 기준(22) 유지. |
| R19 볼트 검색 | 동시 읽기로 구현 (PRD의 메타데이터 캐시는 채택 안 함) | 메타데이터 파싱은 전체의 약 2%(17ms)라 캐시는 효과가 없었다. 대신 목록 단계와 읽기 단계를 나누고, 읽기는 선읽기 창(8개)으로 겹치되 **결과 반영은 목록 순서대로** 해서 건수·바이트 한도와 결과가 순차 스캔과 같다. 경로 안전 검사는 노트마다 그대로 수행한다. 실제 볼트 1,045개 기준 중앙값 약 606ms → 313ms(창 1 대비), 창 크기 1·4·8·16·32 모두 결과 동일. 창 16 이상은 이득이 미미해 8로 고정. 300ms 기준에는 약간 못 미친다. |
| R18 단축키 실기 확인 | 확인 | 실제 앱에서 터미널에 포커스가 있을 때 Ctrl+`로 접기·펼치기가 동작하고, 이후에도 셸이 정상 입력을 받는다(NUL 전달로 인한 이상 없음). 입력창에서도 동작. |
| 결과 카드가 입력창에 가려 보이는 현상 | 기존부터 있던 현상 | 터미널 패널이 높이의 약 36%를 차지하는 기본 레이아웃에서 채팅 영역이 좁아져 생긴다. 변경 전 커밋과 픽셀 단위로 동일하므로 이번 변경의 회귀가 아니다. |
| CI | 통과 | `b47842b` 실행에서 lint, typecheck, test, coordination, services, cargo, build, E2E, audit 전 단계 성공. Hermes 설치가 필요한 vault 테스트 11건은 설치가 없으면 건너뛴다. |
