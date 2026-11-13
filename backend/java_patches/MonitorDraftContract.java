import com.vanv.bee.service.check.CkSourceService;
import com.vanv.bee.bean.CkSource;
import java.util.Date;
public class MonitorDraftContract {
 public static void main(String[] args) {
  CkSourceService service=new CkSourceService();
  for(String cron:new String[]{null,"","   "}) {
   CkSource row=new CkSource();row.setCheckConf("{\"kind\":\"ai\"}");row.setSchedule(cron);
   if(service.calcNextDate(row).getTime()<System.currentTimeMillis()+365L*24*3600*1000)throw new AssertionError("AI draft was scheduled");
  }
  for(String kind:new String[]{"ai","rule"}) {
   CkSource row=new CkSource();row.setCheckConf("{\"kind\":\""+kind+"\"}");row.setSchedule("0 0 * * * ?");
   Date next=service.calcNextDate(row);
   if(next.getTime()<=System.currentTimeMillis() || next.getTime()>System.currentTimeMillis()+2*3600*1000)throw new AssertionError("Cron behavior changed");
  }
  CkSource invalid=new CkSource();invalid.setCheckConf("{\"kind\":\"rule\"}");invalid.setSchedule("");
  try {service.calcNextDate(invalid);throw new AssertionError("Invalid rule cron accepted");}catch(IllegalArgumentException expected){}
  System.out.println("PASS: null/empty/blank AI draft; AI/rule cron unchanged; invalid rule cron rejected");
 }
}
