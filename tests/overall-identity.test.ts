import { test } from "node:test";
import { execFileSync } from "node:child_process";
test("overall identity matching separates duplicate names and requires exact evidence for aliases", () => {
  execFileSync(
    "python3",
    [
      "-c",
      `
import importlib.util
spec=importlib.util.spec_from_file_location('matcher','scripts/extract-uploaded-overalls.py');m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
def player(id,name,pos):return dict(id=id,external_id=id,name=name,position=pos,is_fictional=False,overall=70)
def row(name,pos,ovr,dob='2000-01-01'):return dict(name=name,position=pos,overall=ovr,birth_date=dob,source_row=2)
pool=[player('wr','Justin Jefferson','WR'),player('lb','Justin Jefferson','LB'),player('a','Jaylon Jones','CB'),player('b','Jaylon Jones','CB'),player('pat','Pat Surtain II','CB')]
bios={'a':dict(birth_date='1997-01-01',last_name='Jones'),'b':dict(birth_date='2002-01-01',last_name='Jones'),'pat':dict(birth_date='2000-01-01',last_name='Surtain')}
matched,unmatched=m.match([row('Justin Jefferson','WR',94),row('Justin Jefferson','MIKE',67),row('Jaylon Jones','CB',69,'1997-01-01'),row('Patrick Surtain II','CB',97)],pool,bios)
assert {r['player_id']:r['overall'] for r in matched}=={'wr':94,'lb':67,'a':69,'pat':97}
assert not unmatched
assert not m.match([row('Jaylon Jones','CB',99)],pool,bios)[0]
assert not m.match([row('Patrick Surtain II','CB',99,'2001-01-01')],pool,bios)[0]
assert not m.match([row('Chris Braswell','REDG',73)],[player('k','Chris Boswell','K')],{})[0]
`,
    ],
    { stdio: "pipe" },
  );
});
