import http from 'k6/http';
import {check,sleep} from 'k6';
export const options={
  stages:[{duration:'1m',target:5},{duration:'20m',target:5},
    {duration:'1m',target:10},{duration:'20m',target:10},
    {duration:'1m',target:20},{duration:'20m',target:20}],
  thresholds:{'http_req_duration{kind:warm_api}':['p(95)<1000'],
    'http_req_failed{kind:warm_api}':['rate<0.01']},
};
export default function(){
  if (!__ENV.BASE_URL || __ENV.ALLOW_LOAD_TEST!=='yes') throw new Error('explicit load-test target required');
  const r=http.get(`${__ENV.BASE_URL}/api/catalog/home`,{tags:{kind:'warm_api'}});
  check(r,{'API returns 200':x=>x.status===200});
  sleep(2+Math.random()*3);
}
