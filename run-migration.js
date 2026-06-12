const{createClient}=require('@supabase/supabase-js');
const fs=require('fs');
const s=createClient(process.env.NEXT_PUBLIC_SUPABASE_URL,process.env.SUPABASE_SERVICE_ROLE_KEY);
const sql=fs.readFileSync('supabase/migrations/008_stripe_billing.sql','utf8');
(async()=>{
const{error}=await s.rpc('exec_sql',{query:sql});
if(error)console.log('ERROR:',error.message);
else console.log('Migration applied');
})();
