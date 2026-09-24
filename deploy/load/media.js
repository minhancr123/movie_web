import http from 'k6/http';
import {check,sleep} from 'k6';

export const options={
  stages:[
    {duration:'1m',target:5},{duration:'20m',target:5},
    {duration:'1m',target:10},{duration:'20m',target:10},
    {duration:'1m',target:20},{duration:'20m',target:20}
  ],
  thresholds:{
    'http_req_duration{kind:media_playback}':['p(95)<2000'],
    'http_req_failed{kind:media_playback}':['rate<0.01']
  },
};

export default function(){
  if (!__ENV.BASE_URL || __ENV.ALLOW_LOAD_TEST!=='yes') throw new Error('explicit load-test target required');
  
  // Use a fixture token or mocked ID for testing playback endpoints
  const fixtureId = __ENV.FIXTURE_MEDIA_ID || 'test-media-123';
  const r = http.get(`${__ENV.BASE_URL}/api/playback/${fixtureId}`,{tags:{kind:'media_playback'}});
  
  check(r,{
    'Playback API returns 200':x=>x.status===200,
    'Bitrate info present':x=>x.json('bitrate') !== undefined
  });
  
  sleep(5+Math.random()*5);
}
