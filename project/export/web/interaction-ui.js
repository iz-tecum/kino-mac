const LABELS=Object.freeze({weapon:'WALL WEAPON',ammo:'AMMUNITION',barrier:'BARRICADE',door:'PASSAGE',perk:'PERK MACHINE',power:'POWER',teleporter:'TELEPORTER',upgrade:'PACK-A-PUNCH',box:'MYSTERY BOX',trap:'DEFENSE',equipment:'EQUIPMENT',story:'DISCOVERY'});
const number=value=>Math.max(0,Number.isFinite(value)?Math.floor(value):0);
const format=value=>number(value).toLocaleString('en-US');

// Display-only normalization. Availability, prices, target selection and input
// are owned by gameplay; the card never purchases or repairs anything.
export function describeInteraction(value){
  if(!value||typeof value.title!=='string'||!value.title.trim())return null;
  const requestedKind=({repair:'barrier',teleport:'teleporter',discovery:'story'})[value.kind]??value.kind;
  const kind=Object.hasOwn(LABELS,requestedKind)?requestedKind:'story';
  const cost=Number.isFinite(value.cost)&&value.cost>=0?Math.floor(value.cost):null;
  const points=number(value.points),shortfall=cost===null?0:Math.max(0,cost-points);
  const available=value.available===true;
  const total=kind==='barrier'?Math.min(12,Math.max(1,number(value.total)||6)):0;
  const count=Math.min(total,number(value.count));
  const progress=kind==='barrier'&&available&&value.holding&&count<total&&Number.isFinite(value.progress)?Math.min(1,Math.max(0,value.progress)):0;
  const suppliedReason=String(value.reason??'');
  const reason=available?'':shortfall&&(!suppliedReason||suppliedReason==='Not enough points')?`Need ${format(shortfall)} more points`:suppliedReason||'Unavailable';
  return {id:String(value.id??''),kind,category:LABELS[kind],title:value.title.trim(),detail:String(value.detail??''),
    action:String(value.action||'Interact'),available,reason,cost,price:cost===null?'':cost===0?'NO COST':`${format(cost)} PTS`,points,shortfall,
    key:value.key==='USE'?'USE':'F',hold:value.hold===true,holding:available&&value.holding===true,
    count,total,progress,status:reason|| (kind==='barrier'?count>=total?'Barricade secured':value.holding?'Rebuilding…':'Hold to rebuild':value.hold?'Hold to interact':'')};
}

export class InteractionUI {
  constructor(host){
    this.host=host;this.current=null;this.signature='';this.segments=[];
    host.classList.add('interaction-card');host.hidden=true;
    host.setAttribute('role','status');host.setAttribute('aria-live','polite');host.setAttribute('aria-atomic','true');
    host.innerHTML='<div class="interaction-heading"><span data-ui="category"></span><span class="interaction-price" data-ui="price"></span></div><div class="interaction-main"><div class="interaction-copy"><strong data-ui="title"></strong><span class="interaction-detail" data-ui="detail"></span></div><div class="interaction-input" data-ui="input"><kbd data-ui="key"></kbd><span data-ui="action"></span></div></div><div class="interaction-footer" data-ui="footer"><span data-ui="status"></span><span class="interaction-count" data-ui="count"></span></div><div class="interaction-boards" data-ui="boards" role="progressbar" aria-label="Barricade boards"></div>';
    this.nodes=Object.fromEntries([...host.querySelectorAll('[data-ui]')].map(node=>[node.dataset.ui,node]));
  }
  update(value){
    const model=describeInteraction(value);this.current=model;
    if(!model){this.host.hidden=true;this.signature='';return;}
    this.host.hidden=false;
    const {progress,...staticModel}=model,signature=JSON.stringify(staticModel);
    if(signature!==this.signature){
      this.signature=signature;
      this.host.dataset.kind=model.kind;this.host.dataset.available=String(model.available);this.host.dataset.holding=String(model.holding);
      for(const key of ['category','price','title','detail','key','action','status'])this.nodes[key].textContent=model[key];
      this.nodes.detail.hidden=!model.detail;this.nodes.price.hidden=model.cost===null;
      this.nodes.input.hidden=!model.available;
      this.nodes.key.dataset.hold=String(model.hold);
      this.nodes.action.textContent=(model.hold?'HOLD · ':'')+model.action;
      this.nodes.footer.hidden=!model.status&&!model.total;
      this.nodes.count.textContent=model.total?`${model.count} / ${model.total} BOARDS`:'';
      this.nodes.boards.hidden=!model.total;
      if(model.total){
        this.nodes.boards.setAttribute('aria-valuemin','0');this.nodes.boards.setAttribute('aria-valuemax',String(model.total));this.nodes.boards.setAttribute('aria-valuenow',String(model.count));
        if(this.segments.length!==model.total){this.nodes.boards.replaceChildren();this.segments=Array.from({length:model.total},()=>{const slot=this.host.ownerDocument.createElement('span');slot.setAttribute('aria-hidden','true');const fill=this.host.ownerDocument.createElement('i');slot.append(fill);this.nodes.boards.append(slot);return {slot,fill};});}
      }
    }
    for(let index=0;index<this.segments.length;index++){
      const {slot,fill}=this.segments[index],complete=index<model.count;
      slot.dataset.complete=String(complete);slot.dataset.active=String(index===model.count&&model.holding);
      fill.style.transform=`scaleX(${complete?1:index===model.count?progress:0})`;
    }
  }
  snapshot(){return this.current?{...this.current,visible:!this.host.hidden}:{visible:false};}
}
