import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const app=await readFile(new URL('../public/app.js',import.meta.url),'utf8');
const handlers=app.slice(app.indexOf(' async function saveRole(role)'),app.indexOf('\n // Dashboard Quick Actions'));

function harness(accept) {
  const calls=[],messages=[],controls=[{disabled:false},{disabled:false}];
  const role={value:'AI'}, status={hidden:true,textContent:''}, form={addEventListener(){}};
  const elements={'#role':role,'#role-validation-status':status,'#role-form':form};
  const api=(path,method,data)=>new Promise((resolve,reject)=>calls.push({path,method,data,resolve,reject}));
  const toast={success:value=>messages.push(value),error:value=>messages.push(value)};
  const context=vm.createContext({state:{role:'已有岗位'},api,toast,canSwitchRole:()=>true,writeDraft:async()=>{},refresh:async()=>{},showRoleNext(){},window:{confirm:()=>accept},$:selector=>elements[selector],$$:selector=>selector==='.preset-chip' ? [] : controls});
  vm.runInContext(`let roleSaveBusy=false; ${handlers}`,context);
  return {context,calls,messages,controls,status};
}

test('canceling an uncertain role leaves the existing role unchanged', async () => {
  const h=harness(false);
  const saving=vm.runInContext("saveRole('AI')",h.context);
  await new Promise(resolve=>setImmediate(resolve));
  h.calls[0].resolve({status:'needs_confirmation',confirmation_token:'test',message:'暂时无法判断'});
  await saving;
  assert.equal(h.calls.length,1);
  assert.equal(vm.runInContext('state.role',h.context),'已有岗位');
  assert.match(h.status.textContent,/尚未保存/);
  assert.ok(h.controls.every(item=>!item.disabled));
});

test('confirming an uncertain role sends the explicit confirmation token', async () => {
  const h=harness(true);
  const saving=vm.runInContext("saveRole('AI')",h.context);
  await new Promise(resolve=>setImmediate(resolve));
  h.calls[0].resolve({status:'needs_confirmation',confirmation_token:'test',message:'暂时无法判断'});
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(h.calls[1].data.confirmation_token,'test');
  h.calls[1].resolve({status:'saved',role:'AI'});
  await saving;
  assert.match(h.messages.at(-1),/已设定/);
});
