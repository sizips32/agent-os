import { test, expect } from 'vitest'
import { execFileSync } from 'node:child_process'
import path from 'node:path'
test('image declaration admits only explicit native vision configuration without changing settings', () => {
  const code = `import sys,json\nsys.path.insert(0,sys.argv[1])\nfrom admission import inspect_config\ncases=[{}, {'model':{'supports_vision':True}}, {'model':{'supports_vision':True},'agent':{'image_input_mode':'auto'}}, {'model':{'supports_vision':'true'},'agent':{'image_input_mode':'native'}}, {'model':{'supports_vision':True},'agent':{'image_input_mode':'native'}}]\nprint(json.dumps([inspect_config(c,True)['nativeImageAllowed'] for c in cases]))`
  const result = execFileSync('/usr/bin/python3', ['-I','-B','-c',code,path.resolve('protected')], { encoding:'utf8', timeout:5000 })
  expect(JSON.parse(result)).toEqual([false,false,false,false,true])
})
