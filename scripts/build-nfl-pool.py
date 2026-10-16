"""Build an attributed NFL pool from downloaded nflverse CSVs; never fetch EA data.
Usage: python scripts/build-nfl-pool.py ROSTERS.csv STATS.csv YYYY-MM-DD
"""
import csv, datetime, json, math, pathlib, sys, uuid, collections
roster_path, stats_path, as_of = sys.argv[1:]
today=datetime.date.fromisoformat(as_of)
limits={'QB':3,'RB':3,'FB':1,'WR':6,'TE':3,'LT':2,'LG':2,'C':2,'RG':2,'RT':2,'EDGE':4,'DE':2,'DT':4,'LB':5,'CB':6,'FS':2,'SS':2,'K':1,'P':1}
teams=set('ARI ATL BAL BUF CAR CHI CIN CLE DAL DEN DET GB HOU IND JAX KC LAC LAR LV MIA MIN NE NO NYG NYJ PHI PIT SEA SF TB TEN WAS'.split())
alias={'LA':'LAR','JAC':'JAX','WSH':'WAS'}
dataset='nflverse-2026-original-v1'
stats=collections.defaultdict(collections.Counter)
for r in csv.DictReader(open(stats_path)):
 if r['season_type']!='REG' or int(r['week'])>6:continue
 for k,v in r.items():
  try:stats[r['player_id']][k]+=float(v or 0)
  except (ValueError,TypeError):pass
rows={}
for r in csv.DictReader(open(roster_path)):
 if r['status'] not in ('ACT','DEV','RES','INA') or not all(r.get(k) for k in ('gsis_id','birth_date','height','weight')):continue
 team=alias.get(r['team'],r['team'])
 if team not in teams or r['depth_chart_position']=='LS':continue
 r['team']=team
 prior=rows.get(r['gsis_id'])
 if prior and (int(prior.get('week') or 0),prior['status']=='ACT')>(int(r.get('week') or 0),r['status']=='ACT'):continue
 rows[r['gsis_id']]=r
position_counts=collections.Counter();players=[]
def number(v,default=0):
 try:return int(float(v))
 except (ValueError,TypeError):return default
for external,r in sorted(rows.items()):
 pos=r['depth_chart_position']
 if pos=='T':pos='LT' if position_counts['LT']<=position_counts['RT'] else 'RT'
 elif pos=='G':pos='LG' if position_counts['LG']<=position_counts['RG'] else 'RG'
 else:pos={'OLB':'EDGE','ILB':'LB','MLB':'LB','NT':'DT','S':'FS','HB':'RB'}.get(pos,pos)
 if pos not in limits:continue
 born=datetime.date.fromisoformat(r['birth_date']);age=today.year-born.year-((today.month,today.day)<(born.month,born.day))
 if not 18<=age<=50:continue
 position_counts[pos]+=1
 st=stats[external]
 if pos=='QB':performance=st['passing_yards']/100+st['passing_tds']*2-st['passing_interceptions']*1.5+st['rushing_yards']/50
 elif pos in ('RB','FB'):performance=st['rushing_yards']/20+st['receiving_yards']/30+(st['rushing_tds']+st['receiving_tds'])*3
 elif pos in ('WR','TE'):performance=st['receiving_yards']/20+st['receptions']/3+st['receiving_tds']*3
 elif pos in ('EDGE','DE','DT','LB','CB','FS','SS'):performance=st['def_tackles_solo']/3+st['def_sacks']*5+st['def_interceptions']*6+st['def_pass_defended']*2
 elif pos=='K':performance=st['fg_made']*2+st['pat_made']/3-st['fg_missed']
 elif pos=='P':performance=st['pt_att']/2+st['pt_inside_20']+st['pt_net_yards']/100
 else:performance=0 # Blocking cannot be measured from these box-score fields.
 exp=number(r['years_exp']);draft=number(r['draft_number'],300)
 base=64+(8 if r['status']=='ACT' else 3)+min(exp,6)*.7+(max(0,100-draft)/25 if exp<=3 else 0)
 overall=round(min(95,max(56,base+min(17,math.log1p(max(0,performance))*3.5))))
 speed={'QB':67,'RB':87,'FB':72,'WR':88,'TE':76,'LT':57,'LG':54,'C':54,'RG':54,'RT':57,'EDGE':77,'DE':73,'DT':60,'LB':79,'CB':89,'FS':86,'SS':83,'K':56,'P':56}[pos]
 def clamp(v):return max(0,min(99,round(v)))
 attrs={'speed':clamp(speed-max(0,age-29)*.6),'acceleration':clamp(speed+2),'awareness':clamp(overall-2)}
 role={'QB':['throw_power','short_accuracy','medium_accuracy','deep_accuracy','pressure_response','mobility'],'RB':['carrying','vision','agility','power','receiving'],'FB':['run_blocking','carrying','strength'],'WR':['catching','short_route','medium_route','deep_route','release','contested_catch'],'TE':['catching','route_running','run_blocking','strength'],'K':['kick_power','kick_accuracy'],'P':['kick_power','kick_accuracy']}.get(pos,['run_blocking','pass_blocking','strength'] if pos in ('LT','LG','C','RG','RT') else ['tackling','pursuit','pass_rush','block_shedding','man_coverage','zone_coverage'])
 for k in role:attrs[k]=clamp(overall-(4 if k in ('deep_accuracy','contested_catch') else 0))
 # These are game-economy estimates, never reported as actual NFL contracts.
 salary=round((750000+max(0,overall-60)**2*18000)*(1.8 if pos=='QB' else 1)/50000)*50000
 players.append(dict(id=str(uuid.uuid5(uuid.NAMESPACE_URL,dataset+':'+external)),external_id=external,name=r['full_name'],position=pos,age=age,jersey=number(r['jersey_number']),overall=overall,attributes=attrs,salary=salary,height_inches=number(r['height']),weight_lbs=number(r['weight']),development='Unrevealed',source='nflverse 2026 roster/statistics (CC BY 4.0). Fantasy Franchise original provisional ratings, attributes, positional assignments and game contracts; not Madden or EA ratings.',dataset=dataset,history=f"Roster snapshot: {r['team']} · {r['college']}. NFL biography from nflverse. Ratings are a simple experimental status/experience/box-score model; blocking and athletic attributes are estimates, not measured scouting grades. No NFL career history is inferred.",nfl_team=r['team'],rating_source='ff-original-v1',is_fictional=False,stats={k:st[k] for k in ('passing_yards','passing_tds','rushing_yards','rushing_tds','receiving_yards','receiving_tds','def_sacks','def_interceptions')},dataset_label='NFL roster · original provisional ratings'))
for pos,max_slots in limits.items():
 for n in range(max(0,32*max_slots-position_counts[pos])):
  external=f'reserve-{pos}-{n+1}';players.append(dict(id=str(uuid.uuid5(uuid.NAMESPACE_URL,dataset+':'+external)),external_id=external,name=f'Reserve {pos} {n+1:02}',position=pos,age=24,jersey=0,overall=45,attributes={'awareness':45,'speed':50,'strength':50},salary=750000,height_inches=72,weight_lbs=230,development='Normal',source='Fictional depth player created to ensure 32 complete rosters. Not an NFL player or EA rating.',dataset=dataset,history='Fictional roster-depth reserve. This is not a real NFL player.',nfl_team=None,rating_source='ff-original-v1',is_fictional=True,stats={},dataset_label='NFL roster · fictional depth reserve'))
pathlib.Path('data/nfl-2026-pool.json').write_text(json.dumps(players,ensure_ascii=False,separators=(',',':'))+'\n')
manifest={'id':dataset,'as_of':as_of,'season':2026,'real_players':sum(not p['is_fictional'] for p in players),'fictional_depth_reserves':sum(p['is_fictional'] for p in players),'roster_source':'https://github.com/nflverse/nflverse-data/releases/download/rosters/roster_2026.csv','stats_source':'https://github.com/nflverse/nflverse-data/releases/download/stats_player/stats_player_week_2026.csv','license':'CC BY 4.0','credit':'nflverse contributors','rating_source':'Fantasy Franchise original experimental model; not EA/Madden ratings','limitations':['Snapshot is not a live transaction feed.','LT/RT and LG/RG inferred by balanced allocation where source lists T/G; OLB mapped to EDGE.','Box-score model is provisional and not calibrated for simulation.','Contracts and development are original game estimates.','Fictional reserves fill source shortages for the required 53-player template.']}
pathlib.Path('data/nfl-2026-manifest.json').write_text(json.dumps(manifest,indent=2)+'\n')
print(json.dumps(manifest));print('Position coverage',dict(collections.Counter(p['position'] for p in players)))
