import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {createRequire} from 'node:module';
import {runInNewContext} from 'node:vm';

const require=createRequire(import.meta.url);
test('renamed desktop keeps legacy data and settings for existing and fresh installations',()=>{
  const root=mkdtempSync(path.join(tmpdir(),'offerstrike-brand-'));
  const source=readFileSync(new URL('../desktop/main.cjs',import.meta.url),'utf8');
  try {
    for(const existing of [false,true]) {
      const appData=path.join(root,existing?'existing':'fresh');
      const legacy=path.join(appData,'OfferPilot');
      const workspace=path.join(legacy,'workbench');
      if(existing) {
        mkdirSync(workspace,{recursive:true});
        writeFileSync(path.join(workspace,'interview.sqlite'),'isolated database fixture');
        writeFileSync(path.join(workspace,'services.enc'),'isolated encrypted settings fixture');
      }
      const paths={appData,userData:path.join(appData,'OfferStrike')};
      let name;
      const electron={app:{getPath:key=>paths[key],setPath:(key,value)=>{paths[key]=value;},
        setName:value=>{name=value;},requestSingleInstanceLock:()=>false,quit:()=>{}},
        ipcMain:{handle:()=>{},on:()=>{}}};
      const actual=runInNewContext(source+'\n({data:home(),config:configFile()});',{
        require:id=>id==='electron'?electron:require(id)
      });
      assert.equal(name,'OfferStrike');
      assert.equal(paths.userData,legacy);
      assert.equal(actual.data,workspace);
      assert.equal(actual.config,path.join(workspace,'services.enc'));
      if(existing) {
        assert.equal(readFileSync(path.join(actual.data,'interview.sqlite'),'utf8'),'isolated database fixture');
        assert.equal(readFileSync(actual.config,'utf8'),'isolated encrypted settings fixture');
      }
    }
  } finally {rmSync(root,{recursive:true,force:true});}
});
