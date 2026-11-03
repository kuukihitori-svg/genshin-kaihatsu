"""Frame-by-frame audit for the known BV1XSHDzqE2h P2 layout (not a generic tracker).

Run inside the analysis venv. Raw frames/media stay outside Git.
"""
import argparse
import hashlib
import cv2,json,math,numpy as np,time
from pathlib import Path
cv2.setNumThreads(2)
parser=argparse.ArgumentParser(description=__doc__)
parser.add_argument('--media', required=True)
parser.add_argument('--out', required=True)
parser.add_argument('--samples', action='store_true')
parser.add_argument('--max-frames', type=int)
args=parser.parse_args()
expected='1c19533c7177731b8d26f8474d3091c6289effb73313595f9dcd030ef71b1447'
digest=hashlib.sha256()
with Path(args.media).open('rb') as f:
 for chunk in iter(lambda:f.read(1024*1024),b''):digest.update(chunk)
if digest.hexdigest()!=expected:raise SystemExit('This tracker is calibrated only for the documented source media SHA-256')
root=Path(args.out).resolve();root.mkdir(parents=True,exist_ok=True)
if (root/'audit.json').exists():raise SystemExit('Refusing to overwrite an existing audit')
repository=Path(__file__).resolve().parents[1]
cap=cv2.VideoCapture(str(Path(args.media).resolve()));fps=30.0
cap.set(cv2.CAP_PROP_POS_MSEC,2000);ok,reference=cap.read();cap.set(cv2.CAP_PROP_POS_FRAMES,0)
sift=cv2.SIFT_create(nfeatures=5000,contrastThreshold=.018)
rk,rd=sift.detectAndCompute(cv2.cvtColor(reference,cv2.COLOR_BGR2GRAY),None);matcher=cv2.BFMatcher()
tr=json.loads((repository/'video-study/nod-krai-p2.targets.json').read_text())['transform']
mask=np.zeros((440,440),np.uint8);cv2.circle(mask,(226,219),166,255,-1);cv2.circle(mask,(226,219),35,0,-1)
# Clock labels / north marker are fixed postproduction overlays, not map features.
mask[:70,:]=0;mask[:,0:65]=0;mask[:,390:]=0;mask[370:,:]=0
center=np.array([226.,219.,1.])
M=None;last_abs=-9999;prev=None;features=None;rows=[];samples=[];index=0;start=time.time()
# Source spawn of the already-open first teleport. Never inferred from a guessed endpoint.
seed=np.array([tr['originPixelX']-tr['pixelsPerGameUnit']*9367.151,tr['originPixelY']-tr['pixelsPerGameUnit']*1435.7632])
while args.max_frames is None or index<args.max_frames:
 ok,full=cap.read()
 if not ok:break
 t=index/fps;crop=full[:440,:440];gray=cv2.cvtColor(crop,cv2.COLOR_BGR2GRAY)
 row={'frame':index,'timeSeconds':round(t,6)};flow_ok=False;T=None
 if prev is not None and features is not None and len(features)>=5:
  q,st,err=cv2.calcOpticalFlowPyrLK(prev,gray,features,None,winSize=(19,19),maxLevel=3)
  valid=(st[:,0]==1)&(err[:,0]<20)
  a=features[valid];b=q[valid]
  if len(a)>=5:
   T,inl=cv2.estimateAffinePartial2D(a,b,method=cv2.RANSAC,ransacReprojThreshold=1.5,maxIters=500)
   if T is not None:
    sc=math.hypot(T[0,0],T[1,0]);angle=math.degrees(math.atan2(T[1,0],T[0,0]));count=int(inl.sum())
    flow_ok=count>=5 and .97<sc<1.03 and abs(angle)<2 and math.hypot(T[0,2],T[1,2])<45
    row['flowInliers']=count
    if flow_ok and M is not None:
     inverse=np.linalg.inv(np.vstack((T,[0,0,1])));M=(np.vstack((M,[0,0,1]))@inverse)[:2]
    features=b[inl[:,0]==1] if flow_ok else None
 if M is not None and not flow_ok and index%30!=0:M=None
 if index%30==0 or (M is None and index%5==0):
  k,d=sift.detectAndCompute(gray,mask)
  good=[m for m,n in matcher.knnMatch(d,rd,k=2) if m.distance<.68*n.distance] if d is not None else []
  if len(good)>=8:
   a=np.float32([k[m.queryIdx].pt for m in good]);b=np.float32([rk[m.trainIdx].pt for m in good])
   mat,inl=cv2.estimateAffinePartial2D(a,b,method=cv2.RANSAC,ransacReprojThreshold=2.5,maxIters=2000)
   if mat is not None:
    scale=math.hypot(mat[0,0],mat[1,0]);angle=math.degrees(math.atan2(mat[1,0],mat[0,0]));count=int(inl.sum())
    spread=np.ptp(a[inl[:,0]==1],axis=0)
    if count>=8 and count/len(good)>.45 and abs(angle)<2 and ((.40<scale<.48) or (1.24<scale<1.42)) and min(spread)>35:
     M=mat;last_abs=index;row['absoluteInliers']=count;row['scale']=round(scale,5)
 if index==1050:
  M=np.array([[.444,0,seed[0]-.444*226],[0,.444,seed[1]-.444*219]]);last_abs=index;row['seed']='tp1681-tranPosition'
 if M is not None and index-last_abs<=90:
  p=M@center
  x=(tr['originPixelX']-p[0])/tr['pixelsPerGameUnit'];y=(tr['originPixelY']-p[1])/tr['pixelsPerGameUnit']
  row.update({'x':round(x,3),'y':round(y,3),'status':'absolute' if 'absoluteInliers' in row else 'flow'})
 else:row['status']='unlocalized'
 # Refresh feature tracks without reusing the source arrow or frame overlays.
 if features is None or len(features)<35 or index%15==0:
  features=cv2.goodFeaturesToTrack(gray,maxCorners=180,qualityLevel=.008,minDistance=5,mask=mask)
 if args.samples and index%30==0:
  dest=root/f'frames/{index//30:04d}.jpg';dest.parent.mkdir(exist_ok=True)
  cv2.imwrite(str(dest),cv2.resize(full,(1280,720)),[cv2.IMWRITE_JPEG_QUALITY,85]);samples.append({'timeSeconds':t,'file':str(dest.relative_to(root))})
 if index%900==0:
  print('t',int(t),'frames',index,'seconds',round(time.time()-start,1),'located',sum('x'in r for r in rows),flush=True)
 rows.append(row);prev=gray;index+=1
(root/'audit.json').write_text(json.dumps({'fps':fps,'frameCount':index,'sourceSha256':expected,'complete':index==15612,'source':'BV1XSHDzqE2h_p2','rows':rows,'samples':samples},ensure_ascii=False))
print('DONE frames',index,'located',sum('x'in r for r in rows),'seconds',time.time()-start,flush=True)
