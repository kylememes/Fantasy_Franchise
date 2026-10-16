"""Read a user-supplied workbook; match overall ratings without importing attributes."""
import csv,datetime,hashlib,json,re,sys,unicodedata,zipfile
import xml.etree.ElementTree as E
from collections import defaultdict
from pathlib import Path

def normalize(name):
    name=unicodedata.normalize('NFKD',name).encode('ascii','ignore').decode().lower()
    name=re.sub(r'\b(jr|sr|ii|iii|iv|v)\b','',name)
    return re.sub('[^a-z0-9]','',name)

def compatible(a,b):
    groups=[{'QB'},{'RB','HB','FB'},{'WR','TE'},{'LT','RT','LG','RG','C'},{'DT','DE','EDGE','LEDG','REDG'},{'EDGE','DE','LB','MIKE','SAM','WILL'},{'CB','FS','SS'},{'K'},{'P'}]
    return any(a in g and b in g for g in groups)

def extract(path):
    ns={'m':'http://schemas.openxmlformats.org/spreadsheetml/2006/main'}
    with zipfile.ZipFile(path) as z:
        strings=[''.join(t.itertext()) for t in E.fromstring(z.read('xl/sharedStrings.xml')).findall('m:si',ns)]
        rows=[]
        for row in E.fromstring(z.read('xl/worksheets/sheet1.xml')).findall('m:sheetData/m:row',ns)[1:]:
            cells={}
            for c in row.findall('m:c',ns):
                v=c.find('m:v',ns);value=v.text if v is not None else ''.join(c.itertext())
                cells[re.sub('[0-9]','',c.get('r'))]=strings[int(value)] if c.get('t')=='s' else value
            if cells.get('C') and cells.get('D'):
                rating=int(cells['D'])
                if not 0<=rating<=99:raise ValueError('Invalid overall at row '+row.get('r'))
                dob=(datetime.date(1899,12,30)+datetime.timedelta(days=int(cells['BM']))).isoformat() if cells.get('BM') else None
                rows.append(dict(name=cells['C'].strip(),position=cells['B'],team=cells['A'],overall=rating,source_row=int(row.get('r')),birth_date=dob))
    return rows

def match(rows,pool,bios):
    matches=[];unmatched=[];used=set()
    for row in rows:
        candidates=[p for p in pool if not p['is_fictional'] and normalize(p['name'])==normalize(row['name']) and compatible(p['position'],row['position'])]
        method='normalized name + compatible position'
        if len(candidates)>1:
            mapped={'HB':'RB','LEDG':'EDGE','REDG':'EDGE','MIKE':'LB','SAM':'LB','WILL':'LB'}.get(row['position'],row['position'])
            exact=[p for p in candidates if p['position']==mapped]
            if exact:candidates=exact
        if len(candidates)>1:
            candidates=[p for p in candidates if bios.get(p['external_id'],{}).get('birth_date')==row['birth_date']]
            method+=' + birth date'
        if not candidates and row['birth_date']:
            # Resolve nicknames only with exact birth date AND exact surname evidence.
            last=row['name'].split()[-1]
            if last.lower().rstrip('.') in ('jr','sr','ii','iii','iv'):last=row['name'].split()[-2]
            candidates=[p for p in pool if not p['is_fictional'] and compatible(p['position'],row['position']) and bios.get(p['external_id'],{}).get('birth_date')==row['birth_date'] and normalize(bios.get(p['external_id'],{}).get('last_name',''))==normalize(last)]
            method='exact birth date + surname + compatible position'
        if len(candidates)==1 and candidates[0]['id'] not in used:
            p=candidates[0];dob=bios.get(p['external_id'],{}).get('birth_date')
            used.add(p['id']);matches.append(dict(player_id=p['id'],external_id=p['external_id'],app_name=p['name'],source_name=row['name'],position=p['position'],overall=row['overall'],previous_overall=p['overall'],source_row=row['source_row'],match_method=method))
        else:unmatched.append(dict(**row,reason='No unique compatible player match'))
    return matches,unmatched

if __name__=='__main__':
    workbook,rosters=sys.argv[1:3];root=Path(__file__).resolve().parents[1]
    pool=json.loads((root/'data/nfl-2026-pool.json').read_text())
    with open(rosters) as f:bios={r['gsis_id']:r for r in csv.DictReader(f)}
    rows=extract(workbook);matches,unmatched=match(rows,pool,bios)
    checksum=hashlib.sha256(Path(workbook).read_bytes()).hexdigest()
    result=dict(import_id='uploaded-ovr-'+checksum[:12],source_file=Path(workbook).name,sha256=checksum,source_sheet='Madden NFL 27 Launch Roster',source_rows=len(rows),matched_players=len(matches),unmatched_source_rows=len(unmatched),unmatched_app_players=sum(not p['is_fictional'] and p['id'] not in {m['player_id'] for m in matches} for p in pool),matches=matches,unmatched=unmatched)
    (root/'data/uploaded-overalls.json').write_text(json.dumps(result,ensure_ascii=False,separators=(',',':'))+'\n')
    print(json.dumps({k:v for k,v in result.items() if k not in ('matches','unmatched')}))
    print('Unmatched source players rated 85+:',[(r['name'],r['overall'],r['reason']) for r in unmatched if r['overall']>=85])
