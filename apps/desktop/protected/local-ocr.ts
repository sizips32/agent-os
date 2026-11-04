import { execFile } from 'node:child_process'
import { homedir } from 'node:os'
import type { Extracted } from './documents'
export const READ_BUDGET_MS = 90000
export type LocalRunner = (file:string,args:string[],timeout:number,signal?:AbortSignal)=>Promise<string>
export function timeLeft(deadline:number,now=Date.now):number {
  const value=deadline-now()
  if(value<=0)throw Error('extraction_timeout')
  return value
}
export const runLocal:LocalRunner=(file,args,timeout,signal)=>new Promise((resolve,reject)=>{
  if(signal?.aborted){reject(Error('extraction_cancelled'));return}
  execFile('/usr/bin/sandbox-exec',['-p','(version 1)(allow default)(deny network*)(deny file-write*)',file,...args],
    {timeout,maxBuffer:2*1024*1024,shell:false,signal,env:{PATH:'/usr/bin:/bin',HOME:homedir(),OMP_THREAD_LIMIT:'2'}},
    (error,stdout)=>{
      if(!error){resolve(stdout);return}
      if(signal?.aborted||error.name==='AbortError'){reject(Error('extraction_cancelled'));return}
      if(error.killed){reject(Error('extraction_timeout'));return}
      try{
        const code=JSON.parse(stdout).error
        const known=['invalid_image','invalid_document','encrypted_file','no_text','document_limit','ocr_failed','extraction_failed']
        reject(Error(known.includes(code)?code:'extraction_failed'))
      }catch{reject(Error('extraction_failed'))}
    })
})
export async function fallbackImageOcr(file:string,options:{deadline:number;signal?:AbortSignal;run?:LocalRunner;now?:()=>number;candidates?:string[]}):Promise<Extracted>{
  const run=options.run||runLocal,now=options.now||Date.now
  let binary='',languages:string[]=[]
  for(const candidate of options.candidates||['/opt/homebrew/bin/tesseract','/usr/local/bin/tesseract']){
    if(options.signal?.aborted)throw Error('extraction_cancelled')
    try{
      const output=await run(candidate,['--list-langs'],Math.min(5000,timeLeft(options.deadline,now)),options.signal)
      const available=new Set(output.split(/\r?\n/).map(v=>v.trim()).filter(v=>/^[a-z][a-z0-9_]{1,15}$/.test(v)))
      languages=['kor','eng'].filter(v=>available.has(v))
      if(languages.length){binary=candidate;break}
    }catch(error){if(error instanceof Error&&['extraction_timeout','extraction_cancelled'].includes(error.message))throw error}
  }
  if(!binary)throw Error('ocr_unavailable')
  let output:string
  try{output=await run(binary,[file,'stdout','-l',languages.join('+'),'--psm','11'],timeLeft(options.deadline,now),options.signal)}
  catch(error){if(error instanceof Error&&['extraction_timeout','extraction_cancelled'].includes(error.message))throw error;throw Error('ocr_failed')}
  if(output.includes('\0'))throw Error('ocr_failed')
  const text=output.trim()
  if(!/[\p{L}\p{N}]/u.test(text))throw Error('no_text')
  const warnings=['Apple OCR 결과를 사용할 수 없어 설치된 Tesseract 로컬 OCR로 재시도했습니다. 외부 업로드 없음.',
    '대체 OCR의 부분 인식 결과입니다. 글자·배치·언어가 누락되거나 잘못 읽힐 수 있으므로 표시된 내용을 확인하세요.']
  if(!languages.includes('kor'))warnings.push('현재 로컬 한국어 인식 자료가 없어 영어·숫자 위주로만 읽었습니다. 한국어 내용은 누락될 수 있습니다.')
  if(!languages.includes('eng'))warnings.push('현재 로컬 영어 인식 자료가 없어 영어 내용은 누락될 수 있습니다.')
  return {units:[{label:'이미지',method:'대체 로컬 OCR (Tesseract · '+languages.join('+')+')',text:text.slice(0,200000)}],totalUnits:1,truncated:text.length>200000,partial:true,warnings}
}
