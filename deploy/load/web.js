import http from 'k6/http';
import {check,sleep} from 'k6';

export const options={
  stages:[{duration:'1m',target:5},{duration:'20m',target:5},
    {duration:'1m',target:10},{duration:'20m',target:10},
    {duration:'1m',target:20},{duration:'20m',target:20}],
  thresholds:{
    'http_req_duration{kind:warm_api}':['p(95)<1000'],
    'http_req_failed{kind:warm_api}':['rate<0.01'],
    // P2 fix: check() failures alone don't make k6 exit non-zero.
    // This threshold ensures a bad body (HTTP 200 but error page) fails the run.
    'checks{kind:warm_api}':['rate>0.99'],
  },
};

export default function(){
  if (!__ENV.BASE_URL || __ENV.ALLOW_LOAD_TEST!=='yes')
    throw new Error('explicit load-test target required');
  const r=http.get(`${__ENV.BASE_URL}/api/catalog/home`,{tags:{kind:'warm_api'}});
  check(r,{
    'API returns 200':x=>x.status===200,
    'body is valid JSON':x=>{try{const j=JSON.parse(x.body);return j&&typeof j==='object'}catch{return false}},
  },{kind:'warm_api'});
  sleep(2+Math.random()*3);
}
