import assert from "node:assert/strict";
import test from "node:test";
import {
  buildBatteryLeaderboards,
  canonicalBatteryPublicationState,
  evaluateBatteryReadiness,
  fingerprintBatteryPublicationState,
  groupD1HeatsByProofAndOrder,
  type BatteryProof,
  type BatteryRegistration,
  type BatteryResult,
} from "./d1-staging-batteries";

test("logical batteries group category rows by proof and displayed number only",()=>{
  const rows=[
    {id:"rx-1",proof_id:"proof-1",battery_order:1,order:1,category:"RX"},
    {id:"sc-1",proof_id:"proof-1",battery_order:1,order:1,category:"SC"},
    {id:"rx-2",proof_id:"proof-1",battery_order:2,order:2,category:"RX"},
    {id:"other-proof",proof_id:"proof-2",battery_order:1,order:3,category:"RX"},
    {id:"legacy",proof_id:null,battery_order:null,order:4,category:"SC"},
  ];
  const groups=groupD1HeatsByProofAndOrder(rows);
  assert.deepEqual([...groups.keys()],["proof-1:1","proof-1:2","proof-2:1"]);
  assert.deepEqual(groups.get("proof-1:1")?.map(row=>row.category),["RX","SC"]);
  assert.equal(groups.get("proof-1:2")?.length,1);
  assert.equal(groups.get("proof-2:1")?.[0]?.id,"other-proof");
});

test("finalization requires one reviewed result or official exception for every registration",()=>{
  const proof:BatteryProof={
    id:"proof",order:1,name:"Prova 1",metricType:"TIME",unit:"s",direction:"LOWER",configured:true,
  };
  const registrations:BatteryRegistration[]=[
    {id:"a",category:"RX",teamName:"Equipe A",athleteNames:["Atleta A"],laneLabel:"P01",heatId:"rx"},
    {id:"b",category:"RX",teamName:"Equipe B",athleteNames:["Atleta B"],laneLabel:"P02",heatId:"rx"},
    {id:"c",category:"SC",teamName:"Equipe C",athleteNames:["Atleta C"],laneLabel:"P01",heatId:"sc"},
  ];
  const results=[
    {id:"ra",registrationId:"a",heatId:"rx",proofId:"proof",status:"VALIDATED",rawValue:"61.2"},
    {id:"rb",registrationId:"b",heatId:"rx",proofId:"proof",status:"PROVISIONAL",rawValue:"63.1"},
    {id:"rc",registrationId:"c",heatId:"sc",proofId:"proof",status:"DNS",rawValue:null},
  ] as const;
  const incomplete=evaluateBatteryReadiness({proof,registrations,results:results.slice(0,2)});
  assert.equal(incomplete.ready,false);
  assert.equal(incomplete.reviewedCount,1);
  assert.equal(incomplete.issues[0]?.code,"NEEDS_REVIEW");
  const completeResults=[
    results[0],
    {...results[1],status:"VALIDATED"},
    results[2],
  ];
  const complete=evaluateBatteryReadiness({proof,registrations,results:completeResults});
  assert.equal(complete.ready,true);
  assert.equal(complete.reviewedCount,3);
});

test("finalization rejects wrong-heat and valueless validated results",()=>{
  const proof:BatteryProof={
    id:"proof",order:1,name:"Prova 1",metricType:"TIME",unit:"s",direction:"LOWER",configured:true,
  };
  const registrations:BatteryRegistration[]=[
    {id:"a",category:"RX",teamName:"Equipe A",athleteNames:[],laneLabel:"P01",heatId:"rx"},
  ];
  const wrongHeat=evaluateBatteryReadiness({proof,registrations,results:[
    {id:"r",registrationId:"a",heatId:"other",proofId:"proof",status:"VALIDATED",rawValue:"10"},
  ]});
  assert.equal(wrongHeat.issues[0]?.code,"WRONG_HEAT");
  const noValue=evaluateBatteryReadiness({proof,registrations,results:[
    {id:"r",registrationId:"a",heatId:"rx",proofId:"proof",status:"VALIDATED",rawValue:null},
  ]});
  assert.equal(noValue.issues[0]?.code,"INVALID_VALUE");
});

test("publication fingerprint is stable by row order and changes for a correction revision",async()=>{
  const registrations:BatteryRegistration[]=[
    {id:"a",category:"RX",teamName:"Equipe A",athleteNames:["Atleta"],laneLabel:"P01",heatId:"rx"},
  ];
  const first={id:"r",registrationId:"a",heatId:"rx",proofId:"proof",status:"VALIDATED",rawValue:"10.000",revision:1};
  const second={...first,id:"s",registrationId:"a"};
  const a=await fingerprintBatteryPublicationState(registrations,[first,second]);
  const b=await fingerprintBatteryPublicationState(registrations,[second,first]);
  const revised=await fingerprintBatteryPublicationState(registrations,[{...first,revision:2},second]);
  const configuredProof:BatteryProof={
    id:"proof",order:1,name:"Prova 1",metricType:"TIME",unit:"s",direction:"HIGHER",configured:true,
  };
  const proofA=await fingerprintBatteryPublicationState(registrations,[first,second],{...configuredProof,direction:"LOWER"});
  const changedProof=await fingerprintBatteryPublicationState(registrations,[first,second],configuredProof);
  assert.equal(a,b);
  assert.notEqual(a,revised);
  assert.notEqual(proofA,changedProof);
  assert.equal(canonicalBatteryPublicationState(registrations,[first,second]),canonicalBatteryPublicationState(registrations,[second,first]));
});

test("battery scoring keeps categories isolated and waits for provisional results",()=>{
  const proof:BatteryProof={
    id:"proof-1",order:1,name:"Prova 1",metricType:"TIME",unit:"s",direction:"LOWER",configured:true,
  };
  const registrations:BatteryRegistration[]=[
    {id:"rx-a",category:"RX",teamName:"RX A",athleteNames:[],laneLabel:"P01",heatId:"rx-heat"},
    {id:"rx-b",category:"RX",teamName:"RX B",athleteNames:[],laneLabel:"P02",heatId:"rx-heat"},
    {id:"sc-a",category:"SC",teamName:"SC A",athleteNames:[],laneLabel:"P01",heatId:"sc-heat"},
  ];
  const results:BatteryResult[]=[
    {id:"result-a",registrationId:"rx-a",proofId:"proof-1",rawValue:"60",status:"VALIDATED",heatId:"rx-heat"},
    {id:"result-b",registrationId:"rx-b",proofId:"proof-1",rawValue:"65",status:"PROVISIONAL",heatId:"rx-heat"},
    {id:"result-sc",registrationId:"sc-a",proofId:"proof-1",rawValue:"90",status:"VALIDATED",heatId:"sc-heat"},
    {id:"outside",registrationId:"rx-a",proofId:"proof-2",rawValue:"1",status:"VALIDATED",heatId:"other-heat"},
  ];
  const board=buildBatteryLeaderboards({proof,registrations,results,eventStatus:"ACTIVE"});
  assert.deepEqual(board.categories,["RX","SC"]);
  assert.equal(board.pendingResultCount,1);
  const rx=board.leaderboards.find(item=>item.category==="RX");
  const sc=board.leaderboards.find(item=>item.category==="SC");
  assert.equal(rx?.entries.length,2);
  assert.equal(rx?.entries[0]?.registrationId,"rx-a");
  assert.equal(sc?.entries.length,1);
});

test("battery placement uses configured direction and never mixes RX with Scale",()=>{
  const proof:BatteryProof={
    id:"load-proof",order:2,name:"Carga máxima",metricType:"LOAD",unit:"kg",direction:"HIGHER",configured:true,
  };
  const registrations:BatteryRegistration[]=[
    {id:"rx-a",category:"RX",teamName:"RX A",athleteNames:[],laneLabel:"R01",heatId:"rx"},
    {id:"rx-b",category:"RX",teamName:"RX B",athleteNames:[],laneLabel:"R02",heatId:"rx"},
    {id:"sc-a",category:"SC",teamName:"SC A",athleteNames:[],laneLabel:"S01",heatId:"sc"},
  ];
  const board=buildBatteryLeaderboards({
    proof,registrations,eventStatus:"ACTIVE",results:[
      {id:"a",registrationId:"rx-a",proofId:proof.id,rawValue:"120",status:"VALIDATED",heatId:"rx"},
      {id:"b",registrationId:"rx-b",proofId:proof.id,rawValue:"100",status:"VALIDATED",heatId:"rx"},
      {id:"c",registrationId:"sc-a",proofId:proof.id,rawValue:"200",status:"VALIDATED",heatId:"sc"},
    ],
  });
  const rx=board.leaderboards.find(item=>item.category==="RX");
  const sc=board.leaderboards.find(item=>item.category==="SC");
  assert.equal(rx?.entries[0]?.registrationId,"rx-a");
  assert.equal(rx?.entries[0]?.proofScores[0]?.placement,1);
  assert.equal(rx?.entries[0]?.proofScores[0]?.unit,"kg");
  assert.equal(rx?.entries[1]?.proofScores[0]?.placement,2);
  assert.equal(sc?.entries.length,1);
  assert.equal(sc?.entries[0]?.proofScores[0]?.placement,1);
});
