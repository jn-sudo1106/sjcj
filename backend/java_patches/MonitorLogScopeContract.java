import com.vanv.bee.controller.SourceCheckController;
import com.vanv.bee.service.check.CkJobLogService;
import com.vanv.bee.bean.CkJobLog;
import com.vanv.sys.bean.SysUser;
import com.baomidou.mybatisplus.core.conditions.query.QueryWrapper;
import com.github.pagehelper.PageInfo;
import org.apache.shiro.subject.Subject;
import org.apache.shiro.subject.SimplePrincipalCollection;
import org.apache.shiro.util.ThreadContext;
import java.lang.reflect.Proxy;
import java.lang.reflect.Field;
import java.util.Collections;

public class MonitorLogScopeContract {
 static QueryWrapper<CkJobLog> captured;
 static class Logs extends CkJobLogService {
  @Override public PageInfo<CkJobLog> pagedObject(Integer page, Integer limit, QueryWrapper<CkJobLog> query) {
   captured=query; return new PageInfo<CkJobLog>(Collections.emptyList());
  }
 }
 static void check(String name, int group, boolean scoped) throws Exception {
  SysUser user=new SysUser(); user.setUserLoginName(name);user.setGroupId(group);
  Subject subject=(Subject)Proxy.newProxyInstance(Subject.class.getClassLoader(),new Class[]{Subject.class},
   (proxy,method,args)-> method.getName().equals("getPrincipals") ? new SimplePrincipalCollection(user,"test") : null);
  ThreadContext.bind(subject);
  try {
   SourceCheckController controller=new SourceCheckController();
   Field service=SourceCheckController.class.getDeclaredField("ckJobLogService");service.setAccessible(true);service.set(controller,new Logs());
   controller.pagedLogs(1,20,391004089L,"1108",null,null,null);
   String sql=captured.getSqlSegment();
   if(sql.contains("group_id")!=scoped)throw new AssertionError(name+" group scope: "+sql);
   if(!sql.contains("job_id") || !sql.contains("source_id"))throw new AssertionError("Run identity filter lost");
   if(scoped&&!captured.getParamNameValuePairs().containsValue(group))throw new AssertionError("Wrong group");
  } finally {ThreadContext.unbindSubject();}
 }
 public static void main(String[] args)throws Exception {
  check("admin",0,false);check("admin",9,false);check("reader",9,true);
  System.out.println("PASS: admin global logs; non-admin group preserved; source/monitor filters preserved");
 }
}
