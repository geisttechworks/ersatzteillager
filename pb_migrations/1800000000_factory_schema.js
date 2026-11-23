migrate((app) => {
  const authenticated = '@request.auth.id != ""';
  const admin = '@request.auth.is_admin = true';

  const createBaseCollection = (id, name, rules) => new Collection({
    id,
    name,
    type: "base",
    system: false,
    ...rules,
    fields: [{
      id: "text3208210256",
      name: "id",
      type: "text",
      system: true,
      required: true,
      primaryKey: true,
      hidden: false,
      presentable: false,
      min: 15,
      max: 15,
      pattern: "^[a-z0-9]+$",
      autogeneratePattern: "[a-z0-9]{15}"
    }],
    indexes: []
  });

  const categories = createBaseCollection("pbc_3292755704", "categories", {
    listRule: authenticated,
    viewRule: authenticated,
    createRule: authenticated,
    updateRule: authenticated,
    deleteRule: authenticated
  });
  categories.fields.add(new TextField({ name: "name", required: true, max: 150 }));
  categories.fields.add(new TextField({ name: "description", max: 5000 }));
  categories.fields.add(new AutodateField({ name: "created", onCreate: true }));
  categories.fields.add(new AutodateField({ name: "updated", onCreate: true, onUpdate: true }));
  app.save(categories);

  const nonNegativeQuantityUpdate = '(@request.body.quantity:isset = false || @request.body.quantity >= 0)';
  const validInitialQuantities = '@request.body.quantity:isset = true && @request.body.quantity >= 0 && @request.body.min_quantity:isset = true && @request.body.min_quantity >= 0';
  const spareParts = createBaseCollection("pbc_614902139", "spare_parts", {
    listRule: authenticated,
    viewRule: authenticated,
    createRule: `${authenticated} && ${validInitialQuantities}`,
    updateRule: `${authenticated} && ${nonNegativeQuantityUpdate} && (@request.body.min_quantity:isset = false || @request.body.min_quantity >= 0)`,
    deleteRule: admin
  });
  const addText = (name, options = {}) => spareParts.fields.add(new TextField({ name, ...options }));
  const addNumber = (name, options = {}) => spareParts.fields.add(new NumberField({ name, min: 0, ...options }));
  addText("legacy_id", { max: 100 });
  addText("installation_location", { max: 200 });
  addText("anlage", { max: 200 });
  addText("name", { required: true, max: 200 });
  addText("article_number", { required: true, max: 100 });
  addText("description", { max: 5000 });
  addText("technical_data", { max: 10000 });
  addText("additional_info", { max: 20000 });
  addText("manufacturer", { max: 200 });
  addText("supplier", { max: 200 });
  addText("unit", { max: 50 });
  addNumber("price");
  addNumber("quantity");
  addNumber("min_quantity");
  addText("location_type", { max: 30 });
  addText("location_number", { max: 100 });
  addText("location_place", { max: 100 });
  addText("location_pid", { max: 100 });
  addText("link", { max: 2000 });
  addText("attachment", { max: 20000000 });
  addText("qr_code", { max: 100 });
  spareParts.fields.add(new RelationField({
    name: "category_id",
    collectionId: categories.id,
    cascadeDelete: false,
    maxSelect: 1,
    required: false
  }));
  spareParts.fields.add(new JSONField({ name: "location_data", maxSize: 1000000 }));
  spareParts.fields.add(new AutodateField({ name: "created", onCreate: true }));
  spareParts.fields.add(new AutodateField({ name: "updated", onCreate: true, onUpdate: true }));
  spareParts.indexes.push(
    "CREATE UNIQUE INDEX `idx_spare_parts_article_number_unique` ON `spare_parts` (LOWER(TRIM(`article_number`))) WHERE TRIM(`article_number`) != ''",
    "CREATE UNIQUE INDEX `idx_spare_parts_legacy_id_unique` ON `spare_parts` (LOWER(TRIM(`legacy_id`))) WHERE `legacy_id` IS NOT NULL AND TRIM(`legacy_id`) != ''"
  );
  app.save(spareParts);

  const inventoryLog = createBaseCollection("pbc_526465744", "inventory_log", {
    listRule: authenticated,
    viewRule: authenticated,
    createRule: `${authenticated} && @request.body.quantity:isset = true && @request.body.quantity >= 0 && @request.body.previous_quantity:isset = true && @request.body.previous_quantity >= 0 && @request.body.new_quantity:isset = true && @request.body.new_quantity >= 0`,
    updateRule: null,
    deleteRule: null
  });
  inventoryLog.fields.add(new RelationField({
    name: "spare_part_id",
    collectionId: spareParts.id,
    cascadeDelete: false,
    maxSelect: 1,
    required: true
  }));
  inventoryLog.fields.add(new SelectField({ name: "action", values: ["in", "out"], maxSelect: 1, required: true }));
  inventoryLog.fields.add(new NumberField({ name: "quantity", min: 0 }));
  inventoryLog.fields.add(new NumberField({ name: "previous_quantity", min: 0 }));
  inventoryLog.fields.add(new NumberField({ name: "new_quantity", min: 0 }));
  inventoryLog.fields.add(new TextField({ name: "notes", max: 20000 }));
  inventoryLog.fields.add(new TextField({ name: "user_name", max: 200 }));
  inventoryLog.fields.add(new TextField({ name: "user_agent", max: 1000 }));
  inventoryLog.fields.add(new TextField({ name: "reason", max: 100 }));
  inventoryLog.fields.add(new TextField({ name: "supplier", max: 200 }));
  inventoryLog.fields.add(new TextField({ name: "order_number", max: 100 }));
  inventoryLog.fields.add(new TextField({ name: "delivery_note_number", max: 100 }));
  inventoryLog.fields.add(new JSONField({ name: "metadata", maxSize: 1000000 }));
  inventoryLog.fields.add(new AutodateField({ name: "created", onCreate: true }));
  app.save(inventoryLog);

  const users = app.findCollectionByNameOrId("users");
  if (!users.fields.getByName("is_admin")) {
    users.fields.add(new BoolField({ name: "is_admin" }));
  }
  users.authRule = "";
  users.listRule = admin;
  users.viewRule = `id = @request.auth.id || ${admin}`;
  users.createRule = admin;
  users.updateRule = `(@request.auth.id = id && @request.body.is_admin:isset = false) || (${admin} && @request.auth.id != id)`;
  users.deleteRule = `${admin} && @request.auth.id != id`;
  users.manageRule = `${admin} && @request.auth.id != id`;
  app.save(users);

  app.db().newQuery(`
    CREATE TRIGGER IF NOT EXISTS users_keep_last_admin_on_update
    BEFORE UPDATE OF is_admin ON users
    WHEN OLD.is_admin = 1
      AND NEW.is_admin = 0
      AND (SELECT COUNT(*) FROM users WHERE is_admin = 1 AND id != OLD.id) = 0
    BEGIN
      SELECT RAISE(ABORT, 'at_least_one_admin_required');
    END
  `).execute();
  app.db().newQuery(`
    CREATE TRIGGER IF NOT EXISTS users_keep_last_admin_on_delete
    BEFORE DELETE ON users
    WHEN OLD.is_admin = 1
      AND (SELECT COUNT(*) FROM users WHERE is_admin = 1 AND id != OLD.id) = 0
    BEGIN
      SELECT RAISE(ABORT, 'at_least_one_admin_required');
    END
  `).execute();

  const settings = app.settings();
  settings.batch.enabled = true;
  settings.backups.cron = "0 2 * * *";
  settings.backups.cronMaxKeep = 30;
  return app.save(settings);
}, () => {
  // Deliberately preserve collections and data on rollback.
});
