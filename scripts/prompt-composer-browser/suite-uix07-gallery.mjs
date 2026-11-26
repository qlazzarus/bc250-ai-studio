// Isolated gallery pagination check. Run with STUDIO_FAKE_DELAY=0.1 and STUDIO_BROWSER_SUITE=gallery-pagination.
export const runUix07Gallery = async ({page, check}) => {
  const {evaluate, waitFor, navigate, clickByText} = page;
  const origin = await evaluate('location.origin');
  await waitFor("!!window.__authHeader", {label:'authorization'});
  const ids = await evaluate(`(async () => {
    const headers = {'Content-Type':'application/json', Authorization:window.__authHeader};
    const ids=[];
    for(let i=0;i<13;i++) {
      const r=await fetch('/api/v1/jobs',{method:'POST',headers,body:JSON.stringify({source:'nsfw',model_id:'fake-sd15',prompt:'gallery pagination '+i,batch_count:1,width:512,height:512,steps:1,cfg_scale:1,seed:i})});
      if(!r.ok) throw Error('create job '+r.status);
      ids.push((await r.json()).job_id);
    }
    return ids;
  })()`);
  check('UIX07 · 갤러리용 작업 13건 생성',13,ids.length);
  await waitFor(`(async () => { const r=await fetch('/api/v1/assets?namespace=nsfw&limit=100&offset=0&archived=false',{headers:{Authorization:window.__authHeader}}); return (await r.json()).length >= 13 })()`,{label:'13 assets',timeout:90000});
  const expected=await evaluate(`(async () => { const r=await fetch('/api/v1/assets?namespace=nsfw&limit=12&offset=12&archived=false',{headers:{Authorization:window.__authHeader}}); return (await r.json()).map(a=>a.asset_id.slice(0,8)) })()`);
  await navigate(`${origin}/art/gallery`);
  await waitFor(`!!document.querySelector('.gallery .pagination button:last-child:not(:disabled)')`,{label:'gallery first page',timeout:20000});
  await clickByText('.gallery .pagination button','다음');
  await waitFor(`location.search === '?page=1'`,{label:'gallery page URL'});
  await waitFor(`(() => {const cards=[...document.querySelectorAll('.gallery .asset-footer small')].map(n=>n.textContent.slice(0,8)); return JSON.stringify(cards) === ${JSON.stringify(JSON.stringify(expected))}})()`,{label:'gallery second page',timeout:20000});
  check('UIX07 · 갤러리 2페이지 주소','?page=1',await evaluate('location.search'));
  check('UIX07 · 갤러리 2페이지 서버 결과',JSON.stringify(expected),JSON.stringify(await evaluate(`[...document.querySelectorAll('.gallery .asset-footer small')].map(n=>n.textContent.slice(0,8))`)));
  await navigate(`${origin}/art/gallery?page=1`);
  await waitFor(`(() => {const cards=[...document.querySelectorAll('.gallery .asset-footer small')].map(n=>n.textContent.slice(0,8)); return JSON.stringify(cards) === ${JSON.stringify(JSON.stringify(expected))}})()`,{label:'gallery cold second page',timeout:20000});
  check('UIX07 · 갤러리 2페이지 직접 진입 결과',JSON.stringify(expected),JSON.stringify(await evaluate(`[...document.querySelectorAll('.gallery .asset-footer small')].map(n=>n.textContent.slice(0,8))`)));
};
