const fs = require('fs');
const vm = require('vm');
const path = require('path');
const { createRequire } = require('module');
const assert = require('node:assert/strict');
const liveDir = 'C:/Users/kupal/Downloads/VED-floor-plan-review-portable';
const liveRequire = createRequire(path.join(liveDir, 'auto-annotate.cjs'));
const code = fs.readFileSync(path.join(liveDir, 'auto-annotate.cjs'), 'utf8');
const Q38 = 'qwen/qwen3.8-27b', Q36 = 'qwen/qwen3.6-27b';
const empty = { status: 'ok', annotations: [] };
const good = { status: 'ok', annotations: [{ label: 'Switch', layer: 'symbols', box_2d: [10,20,30,40] }] };
const context = { manifest: { tile_id:'tile-r0c0', references:[] }, targetBase64:'mock', contactSheets:[], systemInstruction:'mock', responseSchema:{} };

function harness() {
  const queue = [], calls = [], logs = [];
  let now = 1000000;
  class Clock extends Date { static now() { return now; } }
  const sandbox = {
    require(name) {
      if (name === 'sharp') return () => ({ resize() {return this;}, jpeg() {return this;}, async toBuffer() {return Buffer.from('mock');} });
      if (name === 'child_process') return { spawn() {throw Error('Live child processes disabled in tests');}, spawnSync() {throw Error('Live child processes disabled in tests');} };
      return liveRequire(name);
    },
    module:{exports:{}}, __dirname:liveDir,
    process:{env:{GEMINI_API_KEY:'mock-gemini',GROQ_API_KEY:'mock-groq',ENABLE_LOCAL_YOLO:'false',GEMINI_MAX_ROUNDS:'4'}},
    Date:Clock, Buffer, AbortController, setTimeout, clearTimeout,
    console:{log:s=>logs.push(s),warn:s=>logs.push(s),error:s=>logs.push(s)},
    async fetch(url, options) {
      const body=JSON.parse(options.body);
      const model=body.model || url.match(/models\/([^:]+)/)?.[1];
      calls.push({model,body});
      const next=queue.shift();
      assert.ok(next, 'Unexpected extra paid request: '+model);
      assert.equal(model,next.model);
      return new Response(JSON.stringify(next.data),{status:next.status,headers:next.headers||{}});
    }
  };
  vm.createContext(sandbox);
  vm.runInContext(code + '\nmodule.exports._test={callMultiProviderWithModelHopping,parseResetDuration,providerError};',sandbox);
  return {
    api:sandbox.module.exports._test,calls,logs,queue,
    advance(ms){now+=ms;},
    error(model,status,detail,headers){queue.push({model,status,data:{error:detail},headers});},
    ok(model,parsed=good,finish='stop'){queue.push({model,status:200,data:{choices:[{finish_reason:finish,message:{content:JSON.stringify(parsed)}}]}});},
    async run(options={}) {return sandbox.module.exports._test.callMultiProviderWithModelHopping(context,'tile-r0c0',options);},
    done(){assert.equal(queue.length,0);assert.ok(!logs.join('').includes('mock-groq'));}
  };
}

(async()=>{
  // Exact reported path: Gemini quota -> Qwen success -> Qwen 429 -> 3.6,
  // then use 3.6 on subsequent tiles without re-calling blocked models.
  let h=harness();
  h.error('gemini-3.8-flash',429,{message:'You exceeded your current quota'},{'retry-after':'600'});
  h.ok(Q38);await h.run();
  h.error(Q38,429,{message:'Rate limit reached'},{'retry-after':'120'});
  h.ok(Q36);await h.run();
  h.ok(Q36,empty);await h.run();
  assert.deepEqual(h.calls.map(c=>c.model),['gemini-3.8-flash',Q38,Q38,Q36,Q36]);
  h.advance(121000);h.ok(Q38);await h.run();h.done();
  for(const {body,model} of h.calls.filter(c=>c.model.startsWith('qwen/'))){
    assert.equal(body.reasoning_effort,'none',model);
    assert.equal(body.reasoning_format,'hidden');
    assert.equal(body.max_tokens,800);
  }

  // Both Qwen models limited: stop after two calls, then zero on a new tile.
  h=harness();h.error(Q38,429,{message:'Rate limit'});h.error(Q36,429,{message:'Rate limit'});
  await assert.rejects(h.run({useGroqOnly:true}),e=>e.statusCode===429);
  await assert.rejects(h.run({useGroqOnly:true}),e=>e.statusCode===429);
  assert.equal(h.calls.length,2);h.done();

  // A JSON-mode failure containing complete valid output needs no new request.
  h=harness();h.error(Q38,429,{message:'Rate limit'});
  h.error(Q36,400,{code:'json_validate_failed',message:'Failed to validate JSON',failed_generation:'<think>reasoning</think>\n```json\n'+JSON.stringify(good)+'\n```'});
  const recovered=await h.run({useGroqOnly:true});
  assert.equal(recovered.data.recovered_from_error,true);assert.equal(h.calls.length,2);h.done();

  // Malformed/truncated output must fail without repair calls or model rounds.
  for(const broken of ['{"status":"ok","annotations":[', JSON.stringify({status:'ok',annotations:[{label:'bad',layer:'symbols',box_2d:[-2,0,10,20]}]})]){
    h=harness();h.error('gemini-3.8-flash',429,{message:'quota'});h.error(Q38,429,{message:'Rate limit'});
    h.error(Q36,400,{code:'json_validate_failed',message:'Failed JSON',failed_generation:broken});
    await assert.rejects(h.run());assert.equal(h.calls.length,3);h.done();
  }
  h=harness();h.error(Q38,429,{message:'Rate limit'});h.ok(Q36,good,'length');
  await assert.rejects(h.run({useGroqOnly:true}));assert.equal(h.calls.length,2);h.done();

  // Reset headers, not just Retry-After, control the cooldown.
  h=harness();h.error(Q38,429,{message:'Rate limit'},{'retry-after':'2','x-ratelimit-remaining-tokens':'0','x-ratelimit-reset-tokens':'2m30s'});h.ok(Q36);await h.run({useGroqOnly:true});
  h.advance(10000);h.ok(Q36);await h.run({useGroqOnly:true});
  h.advance(141000);h.ok(Q38);await h.run({useGroqOnly:true});
  assert.deepEqual(h.calls.map(c=>c.model),[Q38,Q36,Q36,Q38]);h.done();
  assert.equal(h.api.parseResetDuration('2m59.56s'),179560);
  assert.equal(h.api.parseResetDuration('garbage'),0);
  console.log('PASS: direct 3.8-to-3.6 fallback, cross-tile cooldowns/reset expiry, no repeated rounds, unchanged token cap, JSON recovery/rejection, and truncated-output rejection. All requests mocked; no API tokens used.');
})().catch(error=>{console.error(error);process.exitCode=1;});
