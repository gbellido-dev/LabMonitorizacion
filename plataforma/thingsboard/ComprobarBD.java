import java.sql.Connection;
import java.sql.DriverManager;
import java.sql.ResultSet;

/**
 * Indica el estado de la base de datos de ThingsBoard:
 *   VACIA      -> no hay esquema: hay que instalar
 *   INSTALADA  -> lista para arrancar
 *   INCOMPLETA -> esquema sin usuarios (instalación interrumpida)
 * Reintenta la conexión durante 2 minutos.
 */
public class ComprobarBD {
    public static void main(String[] args) throws Exception {
        String url = System.getenv().getOrDefault("SPRING_DATASOURCE_URL", "jdbc:postgresql://tb-postgres:5432/thingsboard");
        String user = System.getenv().getOrDefault("SPRING_DATASOURCE_USERNAME", "postgres");
        String pass = System.getenv().getOrDefault("SPRING_DATASOURCE_PASSWORD", "postgres");
        Exception ultimo = null;
        for (int i = 0; i < 60; i++) {
            try (Connection c = DriverManager.getConnection(url, user, pass)) {
                ResultSet r = c.createStatement().executeQuery("select to_regclass('public.tb_user') is not null");
                r.next();
                if (!r.getBoolean(1)) { System.out.println("VACIA"); return; }
                ResultSet n = c.createStatement().executeQuery("select count(*) from tb_user");
                n.next();
                System.out.println(n.getLong(1) > 0 ? "INSTALADA" : "INCOMPLETA");
                return;
            } catch (Exception e) {
                ultimo = e;
                Thread.sleep(2000);
            }
        }
        System.err.println("No se puede conectar con la base de datos: " + ultimo);
        System.exit(2);
    }
}
