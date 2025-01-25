const express = require('express');
const mysql = require('mysql2');
const bodyParser = require('body-parser');
const cors = require('cors');

const app = express();
app.use(cors());
app.use(bodyParser.json());


// Database connection
const db = mysql.createConnection({
    host: 'localhost',
    user: 'root',
    password: '',
    database: 'merzona'
});

// Connect to database
db.connect(err => {
    if (err) throw err;
    console.log('Database connected');
});

// Get the latest invoice number
app.get('/invoices/latest', (req, res) => {
    const query = 'SELECT invoice_no FROM invoice_headers ORDER BY id DESC LIMIT 1';
    db.query(query, (err, results) => {
        if (err) {
            return res.status(500).json({ error: 'Error fetching latest invoice number' });
        }

        const latestInvoiceNo = results.length > 0 ? parseInt(results[0].invoice_no) + 1 : 1;
        res.json({ invoiceNo: latestInvoiceNo });
    });
});

app.post('/invoices', (req, res) => {
    const { invoiceNo, customerName, date, terms, dueDate, jobNumber, itemDetails } = req.body;

    // Insert into invoice_headers
    const queryHeader = `
        INSERT INTO invoice_headers (invoice_no, customer_name, date, terms, due_date, job_number)
        VALUES (?, ?, ?, ?, ?, ?)
    `;

    db.query(queryHeader, [invoiceNo, customerName, date, terms, dueDate, jobNumber], (err, result) => {
        if (err) {
            console.error('Error inserting invoice header:', err);
            return res.status(500).json({ error: 'Error inserting invoice header' });
        }

        const invoiceId = result.insertId; // Get the auto-generated ID for the invoice header

        // Insert details
        const queryDetails = `
            INSERT INTO invoice_details (invoice_no, description, amount)
            VALUES ?
        `;
        const detailsData = itemDetails.map(item => [invoiceId, item.description, parseFloat(item.amount)]);

        db.query(queryDetails, [detailsData], err => {
            if (err) {
                console.error('Error inserting invoice details:', err);
                return res.status(500).json({ error: 'Error inserting invoice details' });
            }

            res.status(200).json({ message: 'Invoice created successfully' });
        });
    });
});

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
    db.query(query, params, (err, results) => {
        if (err) {
            console.error('Error fetching data:', err.message);
            res.status(500).send('Internal Server Error');
        } else {
            res.json(results);
        }
    });
});

app.get('/invoices/:invoiceId', (req, res) => {
    const { invoiceId } = req.params;

    // Query to fetch the invoice header and details
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

    db.query(query, [invoiceId], (err, results) => {
        if (err) {
            console.error('Error fetching invoice:', err);
            return res.status(500).json({ error: 'Error fetching invoice' });
        }

        if (results.length === 0) {
            return res.status(404).json({ error: 'Invoice not found' });
        }

        // Group results into a structured object
        const invoice = {
            invoiceId: results[0].invoice_id,
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

        res.status(200).json(invoice);
    });
});


// Start the server
app.listen(3000, () => {
    console.log('Server running on http://localhost:3000');
});
