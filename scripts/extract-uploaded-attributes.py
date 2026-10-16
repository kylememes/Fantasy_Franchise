"""Extract numeric skills using the previously reviewed overall identity matches."""
import csv,hashlib,json,re,sys,zipfile
import xml.etree.ElementTree as E
from pathlib import Path

# Explicit source-to-engine keys, including existing aliases consumed by the app.
MAP = {
 'SpeedRating':'speed','AccelerationRating':'acceleration','StrengthRating':'strength',
 'AgilityRating':'agility','AwarenessRating':'awareness','CatchingRating':'catching',
 'CarryingRating':'carrying','ThrowPowerRating':'throw_power','KickPowerRating':'kick_power',
 'KickAccuracyRating':'kick_accuracy','RunBlockRating':'run_blocking','PassBlockRating':'pass_blocking',
 'TackleRating':'tackling','BreakTackleRating':'break_tackle','JumpingRating':'jumping',
 'KickReturnRating':'kick_return','InjuryRating':'injury','StaminaRating':'stamina',
 'ToughnessRating':'toughness','TruckingRating':'power','ChangeOfDirectionRating':'change_of_direction',
 'BCVisionRating':'vision','StiffArmRating':'stiff_arm','SpinMoveRating':'spin_move',
 'JukeMoveRating':'juke_move','ImpactBlockingRating':'impact_blocking',
 'RunBlockPowerRating':'run_block_power','RunBlockFinesseRating':'run_block_finesse',
 'PassBlockPowerRating':'pass_block_power','PassBlockFinesseRating':'pass_block_finesse',
 'LeadBlockRating':'lead_block','BreakSackRating':'break_sack',
 'ThrowUnderPressureRating':'pressure_response','PowerMovesRating':'power_moves',
 'FinesseMovesRating':'finesse_moves','BlockSheddingRating':'block_shedding',
 'PursuitRating':'pursuit','PlayRecognitionRating':'play_recognition',
 'ManCoverageRating':'man_coverage','ZoneCoverageRating':'zone_coverage',
 'SpectacularCatchRating':'spectacular_catch','CatchInTrafficRating':'contested_catch',
 'ShortRouteRunningRating':'short_route','MediumRouteRunningRating':'medium_route',
 'DeepRouteRunningRating':'deep_route','HitPowerRating':'hit_power','PressRating':'press',
 'ReleaseRating':'release','ThrowAccuracyShortRating':'short_accuracy',
 'ThrowAccuracyMidRating':'medium_accuracy','ThrowAccuracyDeepRating':'deep_accuracy',
 'PlayActionRating':'play_action','ThrowOnTheRunRating':'mobility',
}

def extract(path, reviewed):
    checksum=hashlib.sha256(Path(path).read_bytes()).hexdigest()
    if checksum!=reviewed['sha256']:raise ValueError('Workbook differs from reviewed identity matches')
    ns={'m':'http://schemas.openxmlformats.org/spreadsheetml/2006/main'}
    with zipfile.ZipFile(path) as z:
        strings=[''.join(t.itertext()) for t in E.fromstring(z.read('xl/sharedStrings.xml')).findall('m:si',ns)]
        rows={}
        for row in E.fromstring(z.read('xl/worksheets/sheet1.xml')).findall('m:sheetData/m:row',ns):
            cells={}
            for c in row.findall('m:c',ns):
                v=c.find('m:v',ns);value=v.text if v is not None else ''.join(c.itertext())
                cells[re.sub('[0-9]','',c.get('r'))]=strings[int(value)] if c.get('t')=='s' else value
            rows[int(row.get('r'))]=cells
    headers=rows[1];matches=[]
    if not set(MAP).issubset(set(headers.values())):raise ValueError('Missing rating columns')
    for m in reviewed['matches']:
        row=rows[m['source_row']]
        if row['C'].strip()!=m['source_name'] or int(row['D'])!=m['overall']:raise ValueError('Source identity changed')
        skills={}
        for col,header in headers.items():
            if header not in MAP:continue
            value=int(row[col])
            if not 0<=value<=99:raise ValueError('Invalid skill at row '+str(m['source_row']))
            skills[MAP[header]]=value
        # Remove ambiguous old aggregate estimates by replacing the attributes object.
        matches.append(dict(player_id=m['player_id'],source_row=m['source_row'],attributes=skills))
    return dict(import_id='uploaded-skills-'+checksum[:12],sha256=checksum,source_file=Path(path).name,matched_players=len(matches),mapping=MAP,matches=matches)

if __name__=='__main__':
    root=Path(__file__).resolve().parents[1]
    result=extract(sys.argv[1],json.loads((root/'data/uploaded-overalls.json').read_text()))
    keys=sorted(result['matches'][0]['attributes'])
    output=root/'supabase/.temp/attributes';output.mkdir(parents=True,exist_ok=True)
    with (output/'uploaded-attributes.csv').open('w') as f:
        writer=csv.writer(f,lineterminator='\n');writer.writerow(['player_id','source_row']+keys)
        for m in result['matches']:writer.writerow([m['player_id'],m['source_row']]+[m['attributes'][k] for k in keys])
    (output/'uploaded-attributes-manifest.json').write_text(json.dumps({k:v for k,v in result.items() if k!='matches'},indent=2)+'\n')
    print(json.dumps(dict(players=result['matched_players'],attributes_per_player=len(MAP))))
