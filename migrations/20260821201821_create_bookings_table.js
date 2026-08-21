/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = function (knex) {
  return knex.schema.createTable('bookings', (table) => {
    table.increments('id').primary();
    table.string('client_name', 255).notNullable();
    table.string('phone', 50).notNullable();
    table.string('email', 255).nullable();
    table.string('service_type', 100).notNullable();
    table.date('booking_date').nullable();
    table.time('booking_time').nullable();
    table.text('notes').nullable();
    table.string('status', 50).defaultTo('Pending');
    table.timestamps(true, true); // Generates created_at and updated_at
  });
};

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = function (knex) {
  return knex.schema.dropTableIfExists('bookings');
};