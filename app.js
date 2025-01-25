const express = require('express');
const bodyParser = require('body-parser');
const cors = require('cors');
const mysql = require('mysql2');

const app = express();
app.use(cors());
app.use(bodyParser.json());

// Create a connection pool
const pool = mysql.createPool({
    host: 'localhost',
    user: 'root',
    password: '',
    database: 'merzona',
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0
});

// Get the latest invoice number
app.get('/invoices/latest', (req, res) => {
    const query = 'SELECT invoice_no FROM invoice_headers ORDER BY id DESC LIMIT 1';
    pool.query(query, (err, results) => {
        if (err) {
            return res.status(500).json({ error: 'Error fetching latest invoice number' });
        }

        const latestInvoiceNo = results.length > 0 ? parseInt(results[0].invoice_no) + 1 : 1;
        res.json({ invoiceNo: latestInvoiceNo });
    });
});

// Create or update an invoice
app.post('/invoices', (req, res) => {
    const { invoiceNo, customerName, date, terms, dueDate, jobNumber, itemDetails } = req.body;

    // Get a connection from the pool
    pool.getConnection((err, connection) => {
        if (err) {
            console.error('Error getting database connection:', err);
            return res.status(500).json({ error: 'Error getting database connection' });
        }

        // Start a transaction
        connection.beginTransaction(err => {
            if (err) {
                console.error('Error starting transaction:', err);
                return res.status(500).json({ error: 'Error starting transaction' });
            }

            // Delete existing records in invoice_details based on invoice_no
            const deleteDetailsQuery = `DELETE FROM invoice_details WHERE invoice_no = ?`;
            connection.query(deleteDetailsQuery, [invoiceNo], (err) => {
                if (err) {
                    return connection.rollback(() => {
                        console.error('Error deleting invoice details:', err);
                        res.status(500).json({ error: 'Error deleting invoice details' });
                    });
                }

                // Delete existing records in invoice_headers based on invoice_no
                const deleteHeaderQuery = `DELETE FROM invoice_headers WHERE invoice_no = ?`;
                connection.query(deleteHeaderQuery, [invoiceNo], (err) => {
                    if (err) {
                        return connection.rollback(() => {
                            console.error('Error deleting invoice header:', err);
                            res.status(500).json({ error: 'Error deleting invoice header' });
                        });
                    }

                    // Insert new record into invoice_headers
                    const queryHeader = `
                        INSERT INTO invoice_headers (invoice_no, customer_name, date, terms, due_date, job_number)
                        VALUES (?, ?, ?, ?, ?, ?)
                    `;
                    connection.query(queryHeader, [invoiceNo, customerName, date, terms, dueDate, jobNumber], (err, result) => {
                        if (err) {
                            return connection.rollback(() => {
                                console.error('Error inserting invoice header:', err);
                                res.status(500).json({ error: 'Error inserting invoice header' });
                            });
                        }

                        const invoiceId = result.insertId; // Get the auto-generated ID for the invoice header

                        // Prepare data for inserting into invoice_details
                        const queryDetails = `
                            INSERT INTO invoice_details (invoice_no, description, amount)
                            VALUES ?
                        `;
                        const detailsData = itemDetails.map(item => [invoiceId, item.description, parseFloat(item.amount)]);

                        // Insert new records into invoice_details
                        connection.query(queryDetails, [detailsData], err => {
                            if (err) {
                                return connection.rollback(() => {
                                    console.error('Error inserting invoice details:', err);
                                    res.status(500).json({ error: 'Error inserting invoice details' });
                                });
                            }

                            // Commit the transaction
                            connection.commit(err => {
                                if (err) {
                                    return connection.rollback(() => {
                                        console.error('Error committing transaction:', err);
                                        res.status(500).json({ error: 'Error committing transaction' });
                                    });
                                }

                                // Respond with success message
                                res.status(200).json({ message: 'Invoice created successfully' });
                            });
                        });
                    });
                });
            });
        });
    });
});

// Get sales report
app.get('/sales-report', (req, res) => {
    const { fromDate, toDate } = req.query;

    // Base query with optional date filtering
    let query = `
    SELECT 
      id.id,
      ih.id AS invoice_id,
      ih.customer_name,
      ih.invoice_no,
      ih.date,
      ih.terms,
      ih.due_date,
      ih.job_number,
      id.description,
      id.amount
    FROM invoice_headers ih
    LEFT JOIN invoice_details id ON ih.id = id.invoice_no
    WHERE 1=1
    `;

    // Add date filtering if both fromDate and toDate are provided
    const params = [];
    if (fromDate) {
        query += ` AND ih.date >= ?`;
        params.push(fromDate);
    }
    if (toDate) {
        query += ` AND ih.date <= ?`;
        params.push(toDate);
    }

    // Add ordering
    query += ` ORDER BY id.id DESC`;

    // Execute the query
    pool.query(query, params, (err, results) => {
        if (err) {
            console.error('Error fetching data:', err.message);
            res.status(500).send('Internal Server Error');
        } else {
            res.json(results);
        }
    });
});

// Get invoice details by invoice ID
app.get('/invoices/:invoiceId', (req, res) => {
    const { invoiceId } = req.params;

    const query = `
        SELECT 
            ih.id AS invoice_id,
            ih.invoice_no,
            ih.customer_name,
            ih.date,
            ih.terms,
            ih.due_date,
            ih.job_number,
            id.id AS detail_id,
            id.description,
            id.amount
        FROM invoice_headers ih
        LEFT JOIN invoice_details id ON ih.id = id.invoice_no
        WHERE ih.id = ?
    `;

    pool.query(query, [invoiceId], (err, results) => {
        if (err) {
            console.error('Error fetching invoice details:', err);
            return res.status(500).json({ error: 'Error fetching invoice details' });
        }

        if (results.length === 0) {
            return res.status(404).json({ error: 'Invoice not found' });
        }

        const invoice = {
            invoiceNo: results[0].invoice_no,
            customerName: results[0].customer_name,
            date: results[0].date,
            terms: results[0].terms,
            dueDate: results[0].due_date,
            jobNumber: results[0].job_number,
            details: results.map(row => ({
                detailId: row.detail_id,
                description: row.description,
                amount: row.amount
            }))
        };

        res.json(invoice);
    });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
});