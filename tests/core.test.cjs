const test=require('node:test');
const assert=require('node:assert/strict');
const {PondSimulation,createFish,randomSeed,weatherFromCode,sanitizeSave,fishPose,BODY,PALETTES,createSilverCarpShoal}=require('../core.js');
test('锦鲤会追逐并吃掉鱼食，每颗只记一次',()=>{
  const random=randomSeed(2),fish=createFish(0,random);fish.x=.5;fish.y=.5;fish.angle=0;
  const pond=new PondSimulation([fish],1000,700,random);pond.feed(610,350,8);
  for(let i=0;i<1200;i++)pond.step(1/60);
  assert.equal(pond.food.length,0);assert.equal(fish.eaten,8);assert.equal(pond.totalEaten,8);
});
test('长时间游动保持边界与数值稳定',()=>{
  const random=randomSeed(4),fish=Array.from({length:24},(_,i)=>createFish(i,random));
  const pond=new PondSimulation(fish,390,844,random);
  for(let i=0;i<5000;i++)pond.step(.04);
  for(const f of fish){assert.ok(f.x>=.03&&f.x<=.97);assert.ok(f.y>=.035&&f.y<=.965);assert.ok(Number.isFinite(f.angle));}
});
test('食物有数量上限并会过期',()=>{
  const pond=new PondSimulation([],1000,700,randomSeed(2));for(let i=0;i<40;i++)pond.feed(500,300);
  assert.equal(pond.food.length,180);assert.equal(pond.feed(500,300),false);
  for(let i=0;i<600;i++)pond.step(.05);assert.equal(pond.food.length,0);
});
test('天气代码正确区分晴、阴、雨、雪',()=>{
  for(const c of [0,1])assert.equal(weatherFromCode(c),'sunny');
  for(const c of [2,3,45,48])assert.equal(weatherFromCode(c),'cloudy');
  for(const c of [51,63,80,95])assert.equal(weatherFromCode(c),'rain');
  for(const c of [71,73,75,77,85,86])assert.equal(weatherFromCode(c),'snow');
});
test('读取存档时限制异常数据，保留用户命名和记录',()=>{
  assert.equal(sanitizeSave(null),null);assert.equal(sanitizeSave({fish:[]}),null);
  const saved=sanitizeSave({fish:[{name:'小满',palette:999,size:-8,eaten:37,seed:42}]});
  assert.equal(saved.fish[0].name,'小满');assert.equal(saved.fish[0].eaten,37);assert.equal(saved.fish[0].palette,PALETTES.length-1);assert.equal(saved.fish[0].size,.45);
  assert.equal(sanitizeSave({fish:Array.from({length:100},()=>({name:'鱼'}))}).fish.length,60);
});
test('手绘花纹经过存档清洗后保留，丢弃无效笔触',()=>{
  const data=sanitizeSave({fish:[{name:'小花',marks:[{x:10,y:2,r:3,color:'#bc5036'},{x:NaN,y:2,r:3,color:'#ffffff'},{x:1,y:1,r:3,color:'invalid'}]}]});
  assert.deepEqual(data.fish[0].marks,[{x:10,y:2,r:3,color:'#bc5036'}]);
});
test('鱼食落在各处都能被吃完，包括正好落在鱼身下方',()=>{
  for(let t=0;t<40;t++){
    const random=randomSeed(t*7+1),fish=createFish(0,random);fish.x=.2+random()*.6;fish.y=.2+random()*.6;fish.angle=random()*6.28;
    const pond=new PondSimulation([fish],1200,800,random);pond.scale=1.1;pond.feed(200+random()*800,150+random()*500,9);
    for(let i=0;i<60*24&&pond.food.length;i++)pond.step(1/60);
    assert.equal(fish.eaten,9,`第 ${t} 组没有吃完`);
  }
});
test('游动姿态沿脊柱弯曲，数值有限且体长基本不变',()=>{
  const random=randomSeed(9),fish=Array.from({length:12},(_,i)=>createFish(i,random));
  const pond=new PondSimulation(fish,1000,700,random);
  for(let i=0;i<900;i++)pond.step(1/60);
  for(const f of fish){
    const s=f.size*pond.scale,pose=fishPose(f,s);let len=0;
    assert.ok(pose.every(Number.isFinite));
    for(let i=1;i<=BODY.segments;i++)len+=Math.hypot(pose[i*4]-pose[i*4-4],pose[i*4+1]-pose[i*4-3]);
    assert.ok(Math.abs(len/(BODY.length*s)-1)<.12,`体长偏差 ${len/(BODY.length*s)}`);
  }
});
test('观鱼模式轻点水面，附近的鱼会受惊游开',()=>{
  const random=randomSeed(5),fish=createFish(0,random);fish.x=.5;fish.y=.5;fish.angle=0;
  const pond=new PondSimulation([fish],1000,700,random);pond.step(1/60);
  pond.scare(520,350);assert.ok(fish.flee>0);
  for(let i=0;i<45;i++)pond.step(1/60);
  assert.ok(Math.hypot(fish.x*1000-520,fish.y*700-350)>60);
});
test('锦鲤绕开荷叶丛',()=>{
  const random=randomSeed(11),fish=Array.from({length:16},(_,i)=>createFish(i,random));
  const pond=new PondSimulation(fish,1200,800,random);pond.obstacles=[{x:600,y:400,r:140}];
  let inside=0,samples=0;
  for(let i=0;i<60*60;i++){pond.step(1/60);if(i>300&&i%10===0)for(const f of fish){samples++;if(Math.hypot(f.x*1200-600,f.y*800-400)<140)inside++;}}
  assert.ok(inside/samples<.03,`在荷叶下的比例 ${inside/samples}`);
});

test('纯红花色能随旧存档往返，原有花色编号不变',()=>{
  const red=PALETTES.findIndex(p=>p.kind==='benigoi');
  const saved=sanitizeSave(JSON.parse(JSON.stringify({fish:[{name:'朱砂',palette:red},{name:'墨墨',palette:5}]})));
  assert.equal(saved.fish[0].palette,red);
  assert.equal(PALETTES[saved.fish[1].palette].kind,'karasu');
});
test('青鲢独立于锦鲤名额，混游稳定且不争抢投喂颗粒',()=>{
  const random=randomSeed(38),koi=createFish(0,random),shoal=createSilverCarpShoal(random);
  const pond=new PondSimulation([koi],1000,700,random,shoal);
  assert.equal(pond.allFish.length,5);assert.equal(pond.fish.length,1);assert.equal(shoal.length,4);
  pond.feed(600,350,9);
  for(let i=0;i<3600;i++)pond.step(1/60);
  assert.equal(koi.eaten,9);
  for(const f of shoal){assert.equal(f.eaten,0);assert.ok(fishPose(f,f.size).every(Number.isFinite));assert.ok(f.x>=.03&&f.x<=.97&&f.y>=.035&&f.y<=.965);}
  pond.scare(shoal[0].x*1000,shoal[0].y*700);assert.ok(shoal[0].flee>0);
});

test('青鲢转向响应比锦鲤灵活，急转后脊柱仍连续稳定',()=>{
  function turn(species){
    const f={...createFish(0,()=>.5),species,x:.5,y:.5,size:1,speed:1,angle:0};
    const pond=new PondSimulation([f],4000,3000,()=>1);
    pond.step(0);f.goal={x:.5,y:.85};f.goalTime=100;f.depthGoal=f.depth;
    for(let i=0;i<30;i++)pond.step(1/60);
    return {f,pond};
  }
  const koi=turn(undefined),carp=turn('silvercarp');
  assert.ok(carp.f.angle > koi.f.angle * 1.4, '相同转弯目标下青鲢应更快改变航向');
  const {f,pond}=carp;pond.scare(f.x*4000+30,f.y*3000);
  for(let t=0;t<600;t++){
    pond.step(1/60);const pose=fishPose(f,1);assert.ok(pose.every(Number.isFinite));
    let length=0;for(let i=1;i<=BODY.segments;i++)length+=Math.hypot(pose[i*4]-pose[i*4-4],pose[i*4+1]-pose[i*4-3]);
    assert.ok(Math.abs(length/BODY.length-1)<.15);
  }
});
