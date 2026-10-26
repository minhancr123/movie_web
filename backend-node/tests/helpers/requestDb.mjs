const get=(o,k)=>k.split('.').reduce((v,p)=>v?.[p],o);
const set=(o,k,v)=>{const p=k.split('.'),last=p.pop();let t=o;for(const name of p)t=t[name]??={};t[last]=structuredClone(v)};
const unset=(o,k)=>{const p=k.split('.'),last=p.pop();let t=o;for(const name of p)t=t?.[name];if(t)delete t[last]};
const match=(o,q)=>Object.entries(q).every(([k,v])=>{
 if(k==='$or')return v.some(x=>match(o,x));if(k==='$and')return v.every(x=>match(o,x));const x=get(o,k);
 if(v&&typeof v==='object'&&!(v instanceof Date)&&!Array.isArray(v))return Object.entries(v).every(([op,a])=>op==='$exists'?(x!==undefined)===a:op==='$ne'?x!==a:op==='$lte'?x!==undefined&&x<=a:op==='$gte'?x!==undefined&&x>=a:false);
 return x===v;
});
const apply=(o,u,insert=false)=>{for(const[k,v]of Object.entries(u.$set||{}))set(o,k,v);for(const k of Object.keys(u.$unset||{}))unset(o,k);for(const[k,v]of Object.entries(u.$inc||{}))set(o,k,(get(o,k)||0)+v);for(const[k,v]of Object.entries(u.$addToSet||{})){const xs=get(o,k)||[];if(!xs.includes(v))xs.push(v);set(o,k,xs)}if(insert)for(const[k,v]of Object.entries(u.$setOnInsert||{}))set(o,k,v)};
export const requestDb=(initial=[])=>{
 const tables=new Map([['movie_requests',structuredClone(initial)]]);
 return {tables,collection(name){if(!tables.has(name))tables.set(name,[]);const rows=tables.get(name);return{
  async findOne(q){const x=rows.find(x=>match(x,q));return x?structuredClone(x):null},
  async countDocuments(q){return rows.filter(x=>match(x,q)).length},
  async findOneAndUpdate(q,u,opts={}){let xs=rows.filter(x=>match(x,q));if(opts.sort)xs.sort((a,b)=>{for(const[k,d]of Object.entries(opts.sort)){const av=get(a,k),bv=get(b,k);if(av<bv)return-d;if(av>bv)return d}return 0});let row=xs[0];if(!row&&opts.upsert){if(rows.some(x=>x._id===q._id))throw Object.assign(new Error('duplicate'),{code:11000});row={_id:q._id};rows.push(row);apply(row,u,true)}else if(row)apply(row,u);return row?structuredClone(row):null},
  async updateOne(q,u,opts={}){let row=rows.find(x=>match(x,q)),insert=false;if(!row&&opts.upsert){row={};for(const[k,v]of Object.entries(q))if(!k.startsWith('$')&&(typeof v!=='object'||v===null))row[k]=v;row._id??='n'+rows.length;rows.push(row);insert=true}if(row)apply(row,u,insert);return{matchedCount:row&&!insert?1:0,upsertedCount:insert?1:0}},
  async updateMany(q,u){for(const x of rows.filter(x=>match(x,q)))apply(x,u);return{}},
 }},};
};
