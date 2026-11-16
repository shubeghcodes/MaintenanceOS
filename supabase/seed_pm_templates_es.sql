-- Spanish wording for the seeded quarterly PM templates (run after 0029_language.sql and seed_pm_templates.sql).
-- Safe to re-run. Matches items by template name + English activity; edits made in the app are overwritten.
-- Also fills open work-order checklist items that were copied from these templates before Spanish existed.

with es(template, activity, activity_es, description_es) as (values
  -- HVAC
  ('Quarterly PM – HVAC', 'HVAC Unit Filters', 'Filtros de la unidad HVAC', 'Reemplazar y poner fecha a los filtros de aire de retorno del aire acondicionado con el material aprobado.'),
  ('Quarterly PM – HVAC', 'Blower Fan', 'Ventilador (blower)', 'Revisar y lubricar el motor del blower y los baleros de la flecha, según se necesite.'),
  ('Quarterly PM – HVAC', 'Condenser/Evaporator Coils', 'Serpentines del condensador/evaporador', 'Cepillar y lavar con agua donde las condiciones lo permitan. Limpiar con químico mínimo dos veces al año. Usar peine de aletas para enderezar cuando se necesite.'),
  ('Quarterly PM – HVAC', 'Belts & Pulleys', 'Bandas y poleas', 'Revisar/ajustar poleas, bases del motor y ensambles del motor. Reemplazar bandas según se necesite con aprobación PREVIA.'),
  ('Quarterly PM – HVAC', 'Draft Inducer', 'Inductor de tiro', 'En temporada de calefacción, revisar el inductor de tiro.'),
  ('Quarterly PM – HVAC', 'Outside Air Filters/Dampers', 'Filtros/compuertas de aire exterior', 'Limpiar/reparar los filtros de la compuerta exterior. Limpiar con limpiador no ácido. Reemplazar con filtros del fabricante o equivalentes. No tirar los filtros. Asegurar que las compuertas estén al 20% mínimo o a lo especificado.'),
  ('Quarterly PM – HVAC', 'Refrigerant', 'Refrigerante', 'Hacer prueba electrónica de fugas en todos los puertos de servicio, válvulas Schrader, serpentines del evaporador/condensador, compresores y filtros deshidratadores. Avisar al gerente de cualquier fuga. Reparar fugas de refrigerante por tiempo y material con aprobación previa.'),
  ('Quarterly PM – HVAC', 'Compressors', 'Compresores', 'Revisar los calentadores de cárter del compresor de A/C, el amperaje y los contactores.'),
  ('Quarterly PM – HVAC', 'Heating System', 'Sistema de calefacción', 'Revisar que la calefacción funcione bien en sep/oct. Revisar y limpiar ignitores y válvula de gas en unidades paquete, y la válvula reversible en bombas de calor.'),
  ('Quarterly PM – HVAC', 'Electrical Controls', 'Controles eléctricos', 'Asegurar que todas las tapas, paneles y equipos de controles eléctricos estén en su lugar y fijos. Poner los tornillos que falten. Revisar todas las conexiones/contactores.'),
  ('Quarterly PM – HVAC', 'Thermostat Operations', 'Funcionamiento de termostatos', 'Revisar que todos los termostatos funcionen bien. Asegurar que la unidad entre en modo calor en sep/oct, ventilador encendido y modo frío. Asegurar que el programa del termostato siga los protocolos del cliente. Ajustar según se necesite.'),
  ('Quarterly PM – HVAC', 'Air Balance', 'Balance de aire', 'Revisar problemas obvios de balance del edificio. Si hay señales de presión positiva o negativa, anotarlo en la lista de inspección y contactar al gerente.'),
  ('Quarterly PM – HVAC', 'Condensate Drains', 'Drenajes de condensado', 'En temporada de frío, limpiar el drenaje de condensado y tratar con alguicida no corrosivo. Limpiar la charola y las líneas de drenaje del evaporador con agua caliente.'),
  ('Quarterly PM – HVAC', 'Access Panels', 'Paneles de acceso', 'Asegurar que todos los paneles de acceso, ductos, uniones de pleno, tapas y bases en el techo estén bien fijos.'),
  ('Quarterly PM – HVAC', 'Debris', 'Basura y escombros', 'Asegurar que se retire del techo toda la basura relacionada con el HVAC.'),
  ('Quarterly PM – HVAC', 'Demand Ventilation Systems', 'Sistemas de ventilación por demanda', 'Asegurar que los parámetros ECTO (unidades Lennox) estén bien configurados en cada unidad. Asegurar que las compuertas de aire exterior (OAD) no estén abiertas toda la noche; la mayoría deben cerrar en modo desocupado. Asegurar que los ventiladores funcionen como deben. Revisar el motor de la compuerta.'),
  -- Ventilation
  ('Quarterly PM – Ventilation (Exhaust & Make-up Air)', 'Exhaust Fans Belts, Pulleys and Motors', 'Extractores: bandas, poleas y motores', 'Revisar/ajustar bandas y poleas, bases del motor y ensambles del motor. Reemplazar bandas cada trimestre.'),
  ('Quarterly PM – Ventilation (Exhaust & Make-up Air)', 'Exhaust Fans Bearings', 'Extractores: baleros', 'Lubricar todos los baleros según se necesite.'),
  ('Quarterly PM – Ventilation (Exhaust & Make-up Air)', 'Exhaust Fans Blower Wheel', 'Extractores: rueda del blower', 'Asegurar que la rueda del blower esté balanceada.'),
  ('Quarterly PM – Ventilation (Exhaust & Make-up Air)', 'Exhaust Fans Overall Operation', 'Extractores: funcionamiento general', 'Inspeccionar que funcione correctamente.'),
  ('Quarterly PM – Ventilation (Exhaust & Make-up Air)', 'Exhaust Fans Vibrations & Concerns', 'Extractores: vibraciones y problemas', 'Avisar a la gerencia de cualquier vibración o daño fuera de lo normal. Revisar conexiones eléctricas y el seal-tight.'),
  ('Quarterly PM – Ventilation (Exhaust & Make-up Air)', 'Make-up Air Units Belts, Pulleys and Motors', 'Unidades de aire de reposición: bandas, poleas y motores', 'Revisar/ajustar bandas y poleas, bases del motor y ensambles del motor. Reemplazar bandas cada trimestre.'),
  ('Quarterly PM – Ventilation (Exhaust & Make-up Air)', 'Make-up Air Units Cooling Pads & Fresh Air Intake Filters', 'Unidades de aire de reposición: paneles de enfriamiento y filtros de toma de aire', 'Limpiar los paneles de enfriamiento y/o filtros de toma de aire fresco con agua. Limpiar/reparar filtros de la compuerta de aire exterior. Limpiar con limpiador no ácido. Reemplazar con filtros del fabricante o equivalentes con aprobación. No tirar los filtros.'),
  ('Quarterly PM – Ventilation (Exhaust & Make-up Air)', 'Make-up Air Units Bearings', 'Unidades de aire de reposición: baleros', 'Lubricar todos los baleros según se necesite.'),
  ('Quarterly PM – Ventilation (Exhaust & Make-up Air)', 'Make-up Air Units Overall Operation', 'Unidades de aire de reposición: funcionamiento general', 'Inspeccionar que funcione correctamente.'),
  ('Quarterly PM – Ventilation (Exhaust & Make-up Air)', 'Make-up Air Units Water Sump', 'Unidades de aire de reposición: depósito de agua', 'Sacar el agua y limpiar el depósito mínimo una vez al año.'),
  -- Refrigeration
  ('Quarterly PM – Refrigeration', 'Evaporator/Condenser Coils', 'Serpentines del evaporador/condensador', 'Limpiar serpentines con aspiradora, cepillo, CO2 y/o agua caliente. Limpiar con químico al menos dos veces al año con desengrasante aprobado.'),
  ('Quarterly PM – Refrigeration', 'Drain Pans/Drain Lines', 'Charolas y líneas de drenaje', 'Limpiar charolas y líneas de drenaje con agua caliente y/o CO2. Reparar/reemplazar líneas y charolas según se necesite con aprobación previa.'),
  ('Quarterly PM – Refrigeration', 'Condenser/Evaporator Fan Motors', 'Motores de ventilador del condensador/evaporador', 'Revisar aspas, baleros, bases y ensambles del motor del ventilador para que funcionen y estén en buen estado.'),
  ('Quarterly PM – Refrigeration', 'Electrical Components', 'Componentes eléctricos', 'Revisar todas las conexiones eléctricas, fusibles y componentes: que funcionen bien, su estado y señales de desgaste.'),
  ('Quarterly PM – Refrigeration', 'Compressors', 'Compresores', 'Revisar contactores y componentes de arranque por señales de desgaste.'),
  ('Quarterly PM – Refrigeration', 'Refrigerant', 'Refrigerante', 'Prueba electrónica de fugas en puertos de servicio, válvulas Schrader, serpentines del evaporador/condensador, filtro deshidratador y TXV. Revisar la mirilla donde aplique para confirmar la carga correcta.'),
  ('Quarterly PM – Refrigeration', 'Thermostat', 'Termostato', 'Revisar que el termostato/control de temperatura funcione bien. Asegurar que mantenga los parámetros. Revisar la temperatura de operación de la unidad.'),
  ('Quarterly PM – Refrigeration', 'Defrost/Off Cycle/Time Clocks', 'Deshielo / ciclo de apagado / relojes', 'Revisar que los relojes funcionen bien, los tiempos de ciclo de apagado, la instalación y las conexiones eléctricas.'),
  -- Ice machines
  ('Quarterly PM – Ice Machines', 'Condenser Coils', 'Serpentines del condensador', 'Limpiar serpentines con aspiradora, cepillo, CO2 y/o agua caliente. Limpiar con químico al menos dos veces al año con desengrasante aprobado.'),
  ('Quarterly PM – Ice Machines', 'Evaporators', 'Evaporadores', 'Cepillar y/o usar agua caliente para limpiar los evaporadores. Limpiar con químico al menos dos veces al año, o más donde aplique.'),
  ('Quarterly PM – Ice Machines', 'Water Distribution System', 'Sistema de distribución de agua', 'Cepillar y/o usar agua caliente para limpiar el sistema de distribución de agua. Limpiar con químico y sanitizar al menos dos veces al año, o más si se necesita.'),
  ('Quarterly PM – Ice Machines', 'Electrical Components', 'Componentes eléctricos', 'Revisar todas las conexiones eléctricas, fusibles y componentes: que funcionen bien, su estado y señales de desgaste.'),
  ('Quarterly PM – Ice Machines', 'Drain Pans/Drain Lines', 'Charolas y líneas de drenaje', 'Limpiar charolas y líneas de drenaje con agua caliente y/o CO2. Reparar/reemplazar líneas y charolas según se necesite con aprobación previa.'),
  ('Quarterly PM – Ice Machines', 'Compressors', 'Compresores', 'Revisar contactores y componentes de arranque por señales de desgaste.'),
  ('Quarterly PM – Ice Machines', 'Condenser/Evaporator Fan Motors', 'Motores de ventilador del condensador/evaporador', 'Revisar aspas, baleros, bases y ensambles del motor del ventilador para que funcionen y estén en buen estado.'),
  ('Quarterly PM – Ice Machines', 'Overall Operation', 'Funcionamiento general', 'Tomar el tiempo del llenado y del ciclo de cosecha para confirmar que funcione según las especificaciones del fabricante. Anotar cualquier deficiencia.'),
  ('Quarterly PM – Ice Machines', 'Filters', 'Filtros', 'Reemplazar los filtros de la máquina de hielo con los filtros que da el dueño, cada trimestre o según se necesite.')
),
tpl as (
  update public.pm_template_items i
     set activity_es = es.activity_es, description_es = es.description_es
    from es, public.pm_templates t
   where t.id = i.template_id and t.name = es.template and i.activity = es.activity
  returning i.id
)
update public.wo_checklist_items w
   set activity_es = es.activity_es, description_es = es.description_es
  from es, public.pm_template_items i, public.pm_templates t
 where w.template_item_id = i.id and t.id = i.template_id
   and t.name = es.template and i.activity = es.activity
   and w.activity = es.activity and w.activity_es is null and w.completed_at is null;
