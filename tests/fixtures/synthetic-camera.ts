import type {Page} from '@playwright/test';

/** Stable synthetic frames, independent of the OS virtual-camera driver. Encoding,
 * RTP, SFrame, decoding and rendered-frame assertions remain the real pipeline. */
export async function syntheticCamera(page:Page):Promise<void>{
 await page.evaluate(()=>{
  const original=navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
  const sources=new Set<unknown>();
  navigator.mediaDevices.getUserMedia=async(constraints)=>{
   if(!constraints?.video)return original(constraints);
   const canvas=document.createElement('canvas');canvas.width=640;canvas.height=480;
   const context=canvas.getContext('2d')!;let frame=0;
   const draw=()=>{context.fillStyle='#183453';context.fillRect(0,0,640,480);context.fillStyle='#f0b429';context.fillRect((frame++*7)%580,160,60,60);};draw();
   const stream=canvas.captureStream(30),track=stream.getVideoTracks()[0]!;
   const source={canvas,stream,timer:setInterval(draw,33)};sources.add(source);
   const stop=track.stop.bind(track);track.stop=()=>{clearInterval(source.timer);sources.delete(source);stop();};
   if(constraints.audio){const audio=await original({audio:constraints.audio});audio.getAudioTracks().forEach(track=>stream.addTrack(track));}
   return stream;
  };
 });
}
