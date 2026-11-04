import { constants } from 'node:fs'
import { mkdir, lstat, open, rename, unlink } from 'node:fs/promises'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { validDiscoveryCommand, validDiscoveryView, type DiscoveryCommand, type DiscoveryStoreView } from './discovery-state'
const MAX_BYTES = 512 * 1024
export class DiscoveryStore {
  private queue: Promise<unknown> = Promise.resolve()
  constructor(private directory: string) {}
  execute(command: DiscoveryCommand): Promise<DiscoveryStoreView> {
    if (!validDiscoveryCommand(command)) return Promise.reject(Error('저장 요청 형식이 올바르지 않습니다.'))
    const input = structuredClone(command)
    const run = this.queue.then(()=>this.run(input))
    this.queue = run.catch(()=>{})
    return run
  }
  private async read(): Promise<DiscoveryStoreView> {
    const blank = { revision: 0, records: {}, trash: {}, applied: [] }
    try {
      const directory = await lstat(this.directory)
      if (!directory.isDirectory() || directory.isSymbolicLink()) throw Error('unsafe')
      const file = await open(path.join(this.directory,'reflections.json'),constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_NONBLOCK)
      try {
        const stat = await file.stat()
        if (!stat.isFile() || stat.size>MAX_BYTES) throw Error('invalid')
        const buffer = Buffer.alloc(MAX_BYTES+1)
        let length=0
        while(length<buffer.length) { const result=await file.read(buffer,length,buffer.length-length,null); if(!result.bytesRead)break;length+=result.bytesRead }
        if(length>MAX_BYTES)throw Error('invalid')
        const parsed = JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(buffer.subarray(0,length)))
        if(!validDiscoveryView(parsed))throw Error('invalid')
        return parsed
      } finally { await file.close() }
    } catch(error) {
      if ((error as NodeJS.ErrnoException).code==='ENOENT') return blank
      throw Error('저장 내용을 읽을 수 없습니다. 손상·권한을 확인해 주세요. 기존 파일은 바꾸지 않았습니다.')
    }
  }
  private async write(view: DiscoveryStoreView) {
    await mkdir(this.directory,{recursive:true,mode:0o700})
    const directory=await lstat(this.directory)
    if(!directory.isDirectory()||directory.isSymbolicLink())throw Error('unsafe')
    const bytes=Buffer.from(JSON.stringify(view))
    if(bytes.length>MAX_BYTES)throw Error('limit')
    const tmp=path.join(this.directory,`.pending-${randomUUID()}`)
    try {
      const file=await open(tmp,constants.O_CREAT|constants.O_EXCL|constants.O_WRONLY|constants.O_NOFOLLOW,0o600)
      try { await file.writeFile(bytes);await file.sync() } finally {await file.close()}
      await rename(tmp,path.join(this.directory,'reflections.json'))
    } finally { await unlink(tmp).catch(()=>{}) }
  }
  private async run(command: DiscoveryCommand) {
    const view=await this.read()
    if(command.action==='load')return view
    if(command.revision!==view.revision)throw Error('저장 상태가 바뀌었습니다. 저장 목록을 다시 확인한 뒤 진행해 주세요.')
    if(command.action==='save') {
      view.records[command.snapshot.domain]={snapshot:command.snapshot,savedAt:new Date().toISOString()}
    } else if(command.action==='delete'||command.action==='undo') {
      const from=command.action==='delete'?view.records:view.trash
      const to=command.action==='delete'?view.trash:view.records
      const entry=from[command.domain]
      if(!entry||entry.snapshot.id!==command.id)throw Error('선택한 저장 내용이 바뀌었습니다. 목록을 다시 확인해 주세요.')
      if(command.action==='undo'&&to[command.domain])throw Error('같은 분야에 저장 내용이 있습니다. 덮어쓰지 않고 복구를 중단했습니다.')
      to[command.domain]=entry;delete from[command.domain]
    } else if(command.action==='ai-reserve') {
      view.requests ??= {}
      if(view.requests[command.id])throw Error('이미 요청한 회고입니다. 재전송하지 않고 기존 요청을 확인해 주세요.')
      if(Object.keys(view.requests).length>=1000)throw Error('AI 요청 기록 한도에 도달했습니다.')
      view.requests[command.id]={requestId:command.requestId}
    } else if(command.action==='ai-bind') {
      const record=view.requests?.[command.id]
      if(!record||record.requestId!==command.requestId||record.workId)throw Error('AI 요청 기록이 바뀌었습니다. 재전송하지 않습니다.')
      record.workId=command.workId
    } else {
      if(view.applied.includes(command.id))throw Error('이미 적용한 초안입니다. 중복 적용하지 않았습니다.')
      if(view.applied.length>=1000)throw Error('중복 방지 기록 한도에 도달했습니다. 적용하지 않았습니다.')
      view.applied.push(command.id)
    }
    view.revision++
    try {await this.write(view)} catch {throw Error('맥북 저장에 실패했습니다. 입력은 유지되며 저장 완료로 표시하지 않습니다.')}
    return view
  }
}
