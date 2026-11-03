#!/usr/bin/env python3
"""Decode a guide sequentially; retain native-atlas poses and timestamped OCR.

This produces research evidence, not automatically approved navigation routes.
Videos, screenshots, raw speech transcripts and OCR remain outside the repository.
"""
import argparse
import hashlib
import json
import math
from pathlib import Path
import subprocess
import time

import cv2
import numpy as np


def metadata(path):
    data = json.loads(subprocess.check_output(['ffprobe','-v','error','-show_streams','-show_format','-of','json',str(path)]))
    video = next(stream for stream in data['streams'] if stream['codec_type']=='video')
    numerator, denominator = map(int, video['r_frame_rate'].split('/'))
    return { 'width':video['width'], 'height':video['height'], 'fps':numerator/denominator,
             'codec':video['codec_name'], 'duration':float(data['format']['duration']) }


def decoded_frames(path, info):
    command = ['ffmpeg','-hide_banner','-loglevel','error','-nostdin','-threads','2']
    if info['codec']=='av1':
        command += ['-c:v','libdav1d']
    command += ['-i',str(path),'-map','0:v:0','-an','-fps_mode','passthrough','-f','rawvideo','-pix_fmt','bgr24','-']
    process = subprocess.Popen(command, stdout=subprocess.PIPE)
    count = info['width']*info['height']*3
    try:
        while True:
            raw = process.stdout.read(count)
            if not raw:
                break
            if len(raw)!=count:
                raise ValueError('Incomplete decoded frame')
            yield np.frombuffer(raw, dtype=np.uint8).reshape(info['height'],info['width'],3)
        if process.wait()!=0:
            raise ValueError('FFmpeg failed while decoding')
    finally:
        process.stdout.close()
        if process.poll() is None:
            process.terminate()
        try:
            process.wait(timeout=5)
        except subprocess.TimeoutExpired:
            process.kill()
            process.wait()


class AtlasTracker:
    """Absolute SIFT anchors bound optical flow; missing data stays unlocalized."""
    def __init__(self, cache, center, radius, paimon_template, fps, crop_size=440, origin=(16384,12288), map_name='Teyvat', layout='cheng'):
        data = np.load(cache)
        self.points, self.descriptors = data['points'].astype(np.float32), data['descriptors'].astype(np.float32)
        self.center = np.array([*center,1.]);self.crop_size=crop_size;self.origin=origin;self.map_name=map_name;self.layout=layout
        self.mask = np.zeros((crop_size,crop_size),np.uint8)
        cv2.circle(self.mask,tuple(center),radius-3,255,-1)
        cv2.circle(self.mask,tuple(center),34,0,-1)
        if layout=='cheng':
            self.mask[:65]=0;self.mask[:,:65]=0;self.mask[:,390:]=0;self.mask[370:]=0
        elif layout=='ying':
            self.mask[:70]=0;self.mask[:,:60]=0;self.mask[:,535:]=0;self.mask[510:]=0
        else:
            self.mask[:35]=0
        self.sift = cv2.SIFT_create(nfeatures=4000,contrastThreshold=.015)
        self.matcher = cv2.FlannBasedMatcher(dict(algorithm=1,trees=5),dict(checks=70))
        self.matcher.add([self.descriptors]);self.matcher.train()
        self.paimon = cv2.cvtColor(cv2.imread(str(paimon_template)),cv2.COLOR_BGR2GRAY)
        self.paimon_edges = cv2.Canny(self.paimon,80,160)
        self.fps, self.matrix, self.previous, self.features = fps,None,None,None
        self.last_absolute, self.absolute_rmse = -100000,None;self.last_index=-1
        self.last_strong=-100000;self.last_scale=None;self.last_world=None;self.last_world_frame=-100000

    def update(self, frame, index):
        gray = cv2.cvtColor(frame[:self.crop_size,:self.crop_size],cv2.COLOR_BGR2GRAY)
        ui_score = float(cv2.minMaxLoc(cv2.matchTemplate(gray[5:105,5:115],self.paimon,cv2.TM_CCOEFF_NORMED))[1])
        # Bright sky changes the background under this translucent icon. Its
        # outline remains stable; do not discard a whole glide for that change.
        edge_score = float(cv2.minMaxLoc(cv2.matchTemplate(cv2.Canny(gray[5:105,5:115],80,160),self.paimon_edges,cv2.TM_CCOEFF_NORMED))[1])
        row = {'frame':index,'timeSeconds':round(index/self.fps,6),'status':'unlocalized','mainUiScore':round(ui_score,3),'mapName':self.map_name,'layout':self.layout}
        row['mainUiEdgeScore']=round(edge_score,3)
        if ui_score < .65 and edge_score < .45:
            self.previous=None;self.features=None;self.matrix=None
            self.last_strong=-100000;self.last_world=None
            row['status']='not_main_ui'
            return row
        x,y=map(int,self.center[:2]);probe=frame[max(0,y-35):y+36,max(0,x-35):x+36]
        hsv=cv2.cvtColor(probe,cv2.COLOR_BGR2HSV)
        blue=cv2.inRange(hsv,np.array([78,130,145]),np.array([108,255,255]))
        if cv2.countNonZero(blue)<50:
            self.previous=None;self.features=None;self.matrix=None
            self.last_strong=-100000;self.last_world=None
            row['status']='not_layout'
            return row
        if index-self.last_index!=1:
            self.previous=None;self.features=None;self.matrix=None
        self.last_index=index
        flow_ok=False
        if self.previous is not None and self.features is not None and len(self.features)>=12:
            q,valid,errors=cv2.calcOpticalFlowPyrLK(self.previous,gray,self.features,None,winSize=(19,19),maxLevel=3)
            good=(valid[:,0]==1)&(errors[:,0]<18)
            a,b=self.features[good],q[good]
            if len(a)>=12:
                transform,mask=cv2.estimateAffinePartial2D(a,b,method=cv2.RANSAC,ransacReprojThreshold=1.2,maxIters=700)
                if transform is not None:
                    scale=math.hypot(transform[0,0],transform[1,0])
                    rotation=math.degrees(math.atan2(transform[1,0],transform[0,0]))
                    flow_ok=int(mask.sum())>=12 and .97<scale<1.03 and abs(rotation)<3 and np.linalg.norm(transform[:,2])<35
                    if flow_ok and self.matrix is not None:
                        self.matrix=(np.vstack([self.matrix,[0,0,1]]) @ np.linalg.inv(np.vstack([transform,[0,0,1]])))[:2]
                        row['flowInliers']=int(mask.sum())
                    self.features=b[mask[:,0]==1] if flow_ok else None
        if not flow_ok:
            self.matrix=None
        if index%round(self.fps)==0 or (self.matrix is None and index%6==0):
            keypoints,descriptors=self.sift.detectAndCompute(gray,self.mask)
            matches=self.matcher.knnMatch(descriptors,k=2) if descriptors is not None else []
            good=[m for pair in matches if len(pair)==2 for m,n in [pair] if m.distance<.7*n.distance]
            if len(good)>=7:
                a=np.float32([keypoints[m.queryIdx].pt for m in good]);b=self.points[[m.trainIdx for m in good]]
                matrix,inliers=cv2.estimateAffinePartial2D(a,b,method=cv2.RANSAC,ransacReprojThreshold=2.0,maxIters=3000)
                if matrix is not None:
                    chosen=inliers[:,0]==1;count=int(chosen.sum())
                    residual=np.linalg.norm(a @ matrix[:,:2].T + matrix[:,2] - b,axis=1)
                    rmse=float(np.sqrt(np.mean(residual[chosen]**2)))
                    scale=math.hypot(matrix[0,0],matrix[1,0])
                    spread=np.ptp(a[chosen],axis=0)
                    center_distance=cv2.pointPolygonTest(cv2.convexHull(a[chosen]),tuple(map(float,self.center[:2])),True)
                    projected=matrix @ self.center
                    strong=count>=12 and count/len(good)>=.55 and center_distance>=-20
                    # Narrow fields of view sometimes contain only one bank or
                    # a small city block. Permit a measured local match only
                    # while a recent strong anchor constrains scale and speed.
                    recent=self.last_world is not None and index-self.last_strong<=3*self.fps
                    temporal=recent and count>=7 and count/len(good)>=.5 and center_distance>=-65 and rmse<.6 and self.last_scale is not None and abs(scale/self.last_scale-1)<.03 and np.linalg.norm(projected-self.last_world)<=max(3,(index-self.last_world_frame)/self.fps*26)
                    if min(spread)>45 and .15<scale<3.5 and rmse<1.5 and (strong or temporal):
                        self.matrix=matrix;self.last_absolute=index;self.absolute_rmse=rmse
                        if strong:self.last_strong=index
                        self.last_scale=scale
                        row.update({'absoluteInliers':count,'rmseGameUnits':round(rmse,4),'imageScale':round(scale,5),'anchorClass':'strong' if strong else 'temporally_constrained','strongAnchorFrame':self.last_strong})
        if self.matrix is not None and index-self.last_absolute<=self.fps:
            point=self.matrix @ self.center
            self.last_world=point;self.last_world_frame=index
            row.update({'x':round(self.origin[0]-float(point[0]),4),'y':round(self.origin[1]-float(point[1]),4),
                        'status':'absolute' if 'absoluteInliers' in row else 'flow',
                        'lastAbsoluteFrame':self.last_absolute,'anchorRmseGameUnits':round(self.absolute_rmse,4)})
        if self.features is None or len(self.features)<35 or index%15==0:
            self.features=cv2.goodFeaturesToTrack(gray,maxCorners=180,qualityLevel=.008,minDistance=5,mask=self.mask)
        self.previous=gray
        return row


def text_mask(image):
    """Track white UI glyphs, suppressing large bright terrain/cloud regions."""
    small=cv2.resize(image,None,fx=.5,fy=.5,interpolation=cv2.INTER_AREA)
    low,high=small.min(axis=2),small.max(axis=2)
    white=((low>165)&((high.astype(np.int16)-low)<48)).astype(np.uint8)*255
    count,labels,stats,_=cv2.connectedComponentsWithStats(white,connectivity=8)
    ids=[i for i in range(1,count) if 4<=stats[i,cv2.CC_STAT_HEIGHT]<=24
         and 1<=stats[i,cv2.CC_STAT_WIDTH]<=28 and 5<=stats[i,cv2.CC_STAT_AREA]<=500]
    if len(ids)<2:return np.zeros(white.shape,np.uint8)
    lookup=np.zeros(count,np.uint8);lookup[ids]=255
    return lookup[labels]


def audit(media, output, cache=None, template=None, ocr_stride=15, max_frames=None, map_name='Teyvat', layout='cheng'):
    media,output=Path(media),Path(output)
    output.mkdir(parents=True,exist_ok=True)
    if (output/'summary.json').exists() or (output/'frames.jsonl').exists():
        raise ValueError('Refusing to overwrite an existing audit')
    info=metadata(media)
    if (info['width'],info['height'])!=(1920,1080):
        raise ValueError('This reviewed layout currently requires a 1920x1080 source')
    cv2.setNumThreads(2)
    profiles={'cheng':((226,219),166,440),'ying':((283,270),267,600),'native':((166,123),109,310)}
    center,radius,crop_size=profiles[layout]
    origin=(11264,4096) if map_name=='MoonCanon' else (16384,12288)
    tracker=AtlasTracker(cache,center,radius,template,info['fps'],crop_size,origin,map_name,layout) if cache and template else None
    if ocr_stride:
        from rapidocr_onnxruntime import RapidOCR
        ocr=RapidOCR(intra_op_num_threads=2,inter_op_num_threads=1)
    # Regions are explicit source-layout observations, not live-game click areas.
    regions={'subtitle':(400,740,1540,1000),'interaction':(940,300,1600,830),'quest':(0,370,620,580),'toast':(600,180,1430,510)}
    counts={'absolute':0,'flow':0,'unlocalized':0,'not_main_ui':0,'not_layout':0};events=[];last={};samples=[]
    previous_masks={};last_ocr={};ocr_calls=0
    began=time.time();index=-1
    with (output/'frames.jsonl').open('w') as frames_file:
        for index,frame in enumerate(decoded_frames(media,info)):
            row=tracker.update(frame,index) if tracker else {'frame':index,'timeSeconds':round(index/info['fps'],6),'status':'unlocalized'}
            frames_file.write(json.dumps(row)+'\n');counts[row['status']]+=1
            if ocr_stride and index%ocr_stride==0:
                for name,(x0,y0,x1,y1) in regions.items():
                    crop=frame[y0:y1,x0:x1];mask=text_mask(crop)
                    previous=previous_masks.get(name)
                    changed=previous is None or cv2.countNonZero(cv2.bitwise_xor(mask,previous))>max(12,cv2.countNonZero(mask)*.06)
                    if not changed or index-last_ocr.get(name,-100000)<info['fps']*.2:
                        continue
                    previous_masks[name]=mask;last_ocr[name]=index
                    if cv2.countNonZero(mask)>=20:
                        items,_=ocr(crop);ocr_calls+=1
                    else:items=[]
                    texts=[{'text':item[1],'score':round(float(item[2]),4),
                            'box':[[round(float(p[0])+x0,1),round(float(p[1])+y0,1)] for p in item[0]]}
                           for item in items or [] if item[2]>=.65]
                    value=' | '.join(x['text'] for x in texts)
                    if value!=last.get(name,''):
                        event={'frame':index,'timeSeconds':round(index/info['fps'],6),'region':name,'items':texts}
                        events.append(event);last[name]=value
            if index%round(info['fps']*5)==0:
                target=output/'samples'/f'{index:06d}.jpg';target.parent.mkdir(exist_ok=True)
                cv2.imwrite(str(target),cv2.resize(frame,(1280,720)),[cv2.IMWRITE_JPEG_QUALITY,87])
                samples.append({'frame':index,'timeSeconds':round(index/info['fps'],6),'file':str(target.relative_to(output))})
            if index%round(info['fps']*30)==0:
                print(f'{media.stem}: {index/info["fps"]:.0f}s / {info["duration"]:.0f}s, poses {counts["absolute"]+counts["flow"]}, elapsed {time.time()-began:.1f}s',flush=True)
            if max_frames is not None and index+1>=max_frames:
                break
    with media.open('rb') as stream:digest=hashlib.file_digest(stream,'sha256').hexdigest()
    (output/'ocr.json').write_text(json.dumps({'sourceSha256':digest,'strideFrames':ocr_stride,'notice':'Raw automatic OCR, requires line-by-line review','events':events},ensure_ascii=False,indent=2),encoding='utf-8')
    summary={'schemaVersion':1,'source':media.name,'sourceSha256':digest,**info,'decodedFrames':index+1,
             'decodedToEnd':max_frames is None,'locationCounts':counts,'samples':samples,'ocrEvents':len(events),'ocrCalls':ocr_calls,'mapName':map_name,'layout':layout,
             'elapsedSeconds':round(time.time()-began,2),'reviewStatus':'machine_audit_requires_visual_and_audio_review'}
    (output/'summary.json').write_text(json.dumps(summary,ensure_ascii=False,indent=2),encoding='utf-8')
    print('DONE '+json.dumps({k:v for k,v in summary.items() if k not in ['samples']},ensure_ascii=False),flush=True)


if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--media',required=True);parser.add_argument('--out',required=True)
    parser.add_argument('--atlas-cache');parser.add_argument('--paimon-template')
    parser.add_argument('--map-name',choices=['Teyvat','MoonCanon'],default='Teyvat')
    parser.add_argument('--layout',choices=['cheng','ying','native'],default='cheng')
    parser.add_argument('--ocr-stride',type=int,default=15);parser.add_argument('--max-frames',type=int)
    args=parser.parse_args()
    if args.ocr_stride<0:raise ValueError('OCR stride must be nonnegative; zero disables OCR')
    audit(args.media,args.out,args.atlas_cache,args.paimon_template,args.ocr_stride,args.max_frames,args.map_name,args.layout)
