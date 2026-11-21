const { contextBridge } = require('electron');
let confirm;
const calls = [];
let autostartOn = false;
let state = { running:false, starting:false, skin:'nova', requests:0, active:0,
 subscriptions:[{id:'antigravity',name:'Google Antigravity',connected:false},{id:'claude',name:'Claude',connected:false},{id:'test',name:'Test subscription',connected:true}],
 pending:[{id:'phone',name:'Nova mobile',code:'123456',address:'192.168.1.3',status:'pending'}], sessions:[], blocked:[] };
contextBridge.exposeInMainWorld('bridge', {
 info:async()=>state,
 start:async()=>{state={...state,running:true,startedAt:Date.now()};return state;},
 stop:async()=>{state={...state,running:false};return state;},
 signin:async id=>{calls.push(['signin',id]);return {};},
 signout:async id=>{state.subscriptions=state.subscriptions.map(p=>p.id===id?{...p,connected:false}:p);return {};},
 device:async(id,action)=>{
  calls.push([action,id]);
  if(action==='approve'){const d=state.pending.find(p=>p.id===id);state.pending=state.pending.filter(p=>p.id!==id);state.sessions=[{id,name:d.name,address:d.address,active:true,requests:3,lastSeen:Date.now()}];}
  if(action==='block'){const d=state.sessions.find(p=>p.id===id);state.sessions=state.sessions.filter(p=>p.id!==id);state.blocked=[{id,name:d.name,address:d.address}];}
  if(action==='unblock')state.blocked=state.blocked.filter(p=>p.id!==id);
  return state;},
 window:async a=>{calls.push(['window',a]);},
 autostart:async on=>{if(typeof on==='boolean'){calls.push(['autostart',on]);autostartOn=on;}return autostartOn;},
 closeConfirmed:async()=>{}, onConfirmClose:fn=>{confirm=fn;},
 confirmForTest:()=>confirm(state), callsForTest:()=>calls, setSkinForTest:s=>{state={...state,skin:s};}
});
