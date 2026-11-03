#!/usr/bin/env python3
"""Build local feature indexes with the native map coordinate origins."""
import argparse
import hashlib
import json
import math
from pathlib import Path

import cv2
import numpy as np


ORIGINS={'Teyvat':(16384,12288),'MoonCanon':(11264,4096)}


def build(image_path,catalog_path,map_name,output,max_pixels=25000000):
    image_path,output=Path(image_path),Path(output)
    catalog=json.loads(Path(catalog_path).read_text(encoding='utf-8'))
    points=[p['position'] for p in catalog['targets'] if p['mapName']==map_name]
    if not points:raise ValueError('No native points for this map')
    origin=ORIGINS[map_name]
    whole=cv2.imread(str(image_path),cv2.IMREAD_GRAYSCALE)
    if whole is None:raise ValueError('Cannot decode atlas')
    xs=[origin[0]-p['x'] for p in points];ys=[origin[1]-p['y'] for p in points]
    left=max(0,math.floor(min(xs)-450));right=min(whole.shape[1],math.ceil(max(xs)+450))
    top=max(0,math.floor(min(ys)-450));bottom=min(whole.shape[0],math.ceil(max(ys)+450))
    image=whole[top:bottom,left:right].copy();del whole
    factor=max(1,math.ceil(math.sqrt(image.size/max_pixels)))
    if factor>1:image=cv2.resize(image,None,fx=1/factor,fy=1/factor,interpolation=cv2.INTER_AREA)
    cv2.setNumThreads(2)
    sift=cv2.SIFT_create(nfeatures=65000,contrastThreshold=.015)
    keypoints,descriptors=sift.detectAndCompute(image,None)
    coordinates=np.float32([k.pt for k in keypoints])*factor+np.float32([left,top])
    np.savez(output,points=coordinates,descriptors=descriptors)
    with image_path.open('rb') as f:digest=hashlib.file_digest(f,'sha256').hexdigest()
    meta={'mapName':map_name,'origin':list(origin),'sourceImage':image_path.name,'sourceSha256':digest,
          'nativeCatalogSha256':catalog['source']['sha256'],'crop':[left,top,right,bottom],
          'indexDownsample':factor,'features':len(keypoints),'coordinates':'original atlas pixels; world=origin-pixel'}
    output.with_suffix('.json').write_text(json.dumps(meta,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
    print(json.dumps(meta,ensure_ascii=False),flush=True)


if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--image',required=True);parser.add_argument('--catalog',required=True)
    parser.add_argument('--map-name',choices=ORIGINS,required=True);parser.add_argument('--out',required=True)
    args=parser.parse_args();build(args.image,args.catalog,args.map_name,args.out)
