import test from 'node:test'; import assert from 'node:assert/strict';
import { ArtifactStore } from '../src/store.mjs';
import { AuditLog } from '../src/audit.mjs';
import { ImmutableArtifactError } from '../src/errors.mjs';
import { transition } from '../src/state-machine.mjs';
test('immutable artifacts cannot be overwritten',()=>{const s=new ArtifactStore();s.putImmutable('x',{id:'1',v:1});assert.throws(()=>s.putImmutable('x',{id:'1',v:2}),ImmutableArtifactError)});
test('exactly-once effect suppresses duplicate business effect',()=>{const s=new ArtifactStore();let n=0;const a=s.exactlyOnce('k',()=>++n);const b=s.exactlyOnce('k',()=>++n);assert.equal(n,1);assert.equal(a.duplicate,false);assert.equal(b.duplicate,true);assert.equal(b.value,1)});
test('settled cannot transition backwards to qualified path',()=>assert.throws(()=>transition('SETTLED','DECIDED'),/ILLEGAL_STATE_TRANSITION/));
test('audit chain detects valid append-only history',()=>{const a=new AuditLog();a.append({correlationId:'c',actor:'svc',action:'x',artifactType:'t',artifactId:'1'});a.append({correlationId:'c',causationId:'a',actor:'svc',action:'y',artifactType:'t',artifactId:'2'});assert.equal(a.verifyChain(),true)});
