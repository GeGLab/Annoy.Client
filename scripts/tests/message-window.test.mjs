import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mergeMessageWindow} from '../../src/shared/message-window.ts';
const messages=(start,count)=>Array.from({length:count},(_,index)=>({id:String(start+index).padStart(8,'0'),content:'body'}));
test('bounded history retains the requested side and supports traversing back to newer pages',()=>{
  let cache=messages(500,500);
  const older=mergeMessageWindow(cache,messages(450,50),'before');assert.equal(older.items.length,500);assert.equal(older.items[0].id,'00000450');assert.equal(older.evictedAfter,true);
  const newer=mergeMessageWindow(older.items,messages(950,50),'after');assert.deepEqual(newer.items,cache);assert.equal(newer.evictedBefore,true);
});
test('overlapping responses and edits merge deterministically without duplicate message IDs',()=>{
  const previous=messages(0,100),update={...previous[50],content:'edited'};
  const result=mergeMessageWindow(previous,[...messages(50,100),update],'after');assert.equal(result.items.length,150);assert.equal(result.items[50].content,'edited');assert.equal(new Set(result.items.map(item=>item.id)).size,150);
  assert.equal(mergeMessageWindow(result.items,messages(900,50),'replace').items.length,50);
});
