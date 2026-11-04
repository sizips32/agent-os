const mode = process.argv[2]
const session = process.argv[3] || 'fixture_session'
let prompt = ''
process.stdin.on('data', (c) => (prompt += c))
process.stdin.on('end', () => {
  const send = (v) => process.stdout.write(JSON.stringify(v) + '\n')
  // Captured from the current pure CLI emitter, without launching any agent.
  if (mode.startsWith('gateway_')) {
    const cases = require('./hermes-gateway.fixture.json').cases
    if (mode === 'gateway_wait') {
      send(cases.success[0])
      setInterval(() => {}, 1000)
      return
    }
    let frames = cases[mode.slice('gateway_'.length)]
    if (mode === 'gateway_empty_success') frames = [cases.success[0], {type:'result',session_id:'',exit_code:0,text:'must not record'}]
    if (mode === 'gateway_duplicate_init') frames = [cases.success[0], cases.success[0], ...cases.success.slice(1)]
    if (mode === 'gateway_no_init') frames = cases.success.slice(1)
    if (!frames) throw Error('Unknown offline fixture')
    frames.forEach((frame, i) => setTimeout(() => send(frame), i * 10))
    setTimeout(() => process.exit(mode.includes('failure') ? 1 : 0), frames.length * 10 + 20)
    return
  }
  send({ type: 'system', subtype: 'init', session_id: session })
  if(mode==='vault_error') {send({type:'error',code:'runtime_boundary',stage:'initialization',error:'synthetic credential diagnostic must not persist'});setTimeout(()=>process.exit(1),10);return}
  if (mode === 'protocol_total_budget') {
    for(let i=0;i<4000;i++)send({type:'tool_result',name:'terminal',output:'x'.repeat(5000)})
    setInterval(()=>{},1000);return
  }
  if (mode === 'protocol_event_budget') {
    for(let i=0;i<10002;i++)send({type:'tool_result',name:'terminal'})
    setInterval(()=>{},1000);return
  }
  if (mode === 'many_tool_results') {
    for(let i=0;i<96;i++) {
      send({type:'tool_use',name:'terminal',input:{scope:'synthetic fixture'}})
      send({type:'tool_result',name:'terminal',output:'합성 자료 '.repeat(900)})
    }
    send({type:'result',session_id:session,exit_code:0,text:'fixture research completed'})
    setTimeout(()=>process.exit(0),20);return
  }
  if (mode === 'oversized_protocol_line') {
    send({type:'tool_result',name:'terminal',output:'x'.repeat(262145)})
    setInterval(()=>{},1000);return
  }
  if (mode === 'oversized_final_answer') {
    send({type:'result',session_id:session,exit_code:0,text:'x'.repeat(20001)})
    setTimeout(()=>process.exit(0),20);return
  }
  if (mode === 'delayed_complete') {
    send({ type: 'tool_use', name: 'delegate_task' })
    setTimeout(() => {
      send({ type: 'tool_result', name: 'delegate_task', output: 'fixture only' })
      send({ type: 'result', session_id: session, exit_code: 0, text: 'fixture long analysis completed' })
      process.exit(0)
    }, 200)
    return
  }
  if (mode === 'stream-wait') {
    setTimeout(() => send({ type: 'text', text: 'local partial response' }), 1000)
    setInterval(() => {}, 1000)
    return
  }
  if (mode === 'stream') {
    send({ type: 'text', text: 'partial ' })
    setTimeout(() => {
      send({ type: 'text', text: 'reply' })
      send({ type: 'result', session_id: session, exit_code: 0, text: 'partial reply' })
      process.exit(0)
    }, 400)
    return
  }
  if (mode === 'tools_complete') {
    send({ type: 'tool_use', name: 'skill_view', input: { private: 'not retained' } })
    send({ type: 'tool_result', name: 'skill_view', output: 'private not retained' })
  }
  if (mode === 'wait') {
    setInterval(() => {}, 1000)
    return
  }
  if (mode === 'tool') {
    send({ type: 'tool_use', name: 'fixture' })
    setInterval(() => {}, 1000)
    return
  }
  if (mode === 'invalid') {
    process.stdout.write('not-json\n')
    setInterval(() => {}, 1000)
    return
  }
  if (mode === 'missing') {
    process.exit(0)
    return
  }
  send({ type: 'text', text: 'fixture response' })
  send({
    type: 'result',
    session_id: mode === 'mismatch' ? 'other' : session,
    exit_code: mode === 'failure' ? 1 : 0,
    text: 'fixture response'
  })
  if (mode === 'duplicate')
    send({
      type: 'result',
      session_id: session,
      exit_code: 0,
      text: 'again'
    })
  setTimeout(() => process.exit(mode === 'failure' ? 1 : 0), 10)
})
