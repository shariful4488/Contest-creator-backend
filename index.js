const express = require('express');
const { MongoClient, ServerApiVersion, ObjectId } = require('mongodb');
const cors = require('cors');
const jwt = require('jsonwebtoken');
// const bcrypt = require('bcryptjs');
require('dotenv').config();
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

const app = express();
const port = process.env.PORT || 5000;

// Middleware
app.use(cors());
app.use(express.json());

const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@itnabil.agyee9s.mongodb.net/?appName=ItNabil`;

const client = new MongoClient(uri, {
    serverApi: {
        version: ServerApiVersion.v1,
        strict: true,
        deprecationErrors: true,
    }
});

async function run() {
    try {
        const database = client.db("contest_create");
        const usersCollection = database.collection("users");
        const contestCollection = database.collection("contests");
        const participationCollection = database.collection("participations");

        // --- 1. Admin Statistics ---
        app.get('/admin-stats', async (req, res) => {
            try {
                const users = await usersCollection.estimatedDocumentCount();
                const contests = await contestCollection.estimatedDocumentCount();
                const payments = await participationCollection.find().toArray();
                const revenue = payments.reduce((sum, payment) => sum + parseFloat(payment.price || 0), 0);

                res.send({
                    users,
                    contests,
                    revenue: parseFloat(revenue.toFixed(2))
                });
            } catch (error) {
                res.status(500).send({ message: "Error fetching stats" });
            }
        });

        // --- 2. User Management ---
// --- 2. User Management ---
app.post('/users', async (req, res) => {
  try {
    const user = req.body;
    const query = { email: user.email };
    const existingUser = await usersCollection.findOne(query);

    if (existingUser) {
      return res.send({ message: 'User already exists', insertedId: null });
    }

    const result = await usersCollection.insertOne({
      ...user,
      role: user.role || 'user',
      winCount: 0,
      createdAt: new Date()
    });

    res.send(result);
  } catch (error) {
    console.error("Error creating user:", error);
    res.status(500).send({ message: "Server Error", error: error.message });
  }
});

        app.get('/users', async (req, res) => {
            res.send(await usersCollection.find().toArray());
        });

        app.get('/users/role/:email', async (req, res) => {
            const user = await usersCollection.findOne({ email: req.params.email });
            res.send({ role: user?.role || 'user' });
        });

        app.patch('/users/role/:id', async (req, res) => {
            const { role } = req.body;
            res.send(await usersCollection.updateOne(
                { _id: new ObjectId(req.params.id) }, 
                { $set: { role: role } }
            ));
        });

        app.delete('/users/:id', async (req, res) => {
            res.send(await usersCollection.deleteOne({ _id: new ObjectId(req.params.id) }));
        });

        // --- 3. Contest Management ---
        app.get('/contests', async (req, res) => {
            const email = req.query.email;
            let query = {};
            if (email) query = { creatorEmail: email };
            res.send(await contestCollection.find(query).toArray());
        });

        app.post('/contests', async (req, res) => {
            const contest = req.body;
            res.send(await contestCollection.insertOne({ 
                ...contest, 
                participationCount: 0, 
                status: 'Pending', 
                createdAt: new Date() 
            }));
        });

        app.get('/contests/:id', async (req, res) => {
            res.send(await contestCollection.findOne({ _id: new ObjectId(req.params.id) }));
        });

        app.patch('/contests/:id', async (req, res) => {
            const id = req.params.id;
            const updatedData = req.body;
            delete updatedData._id; 
            res.send(await contestCollection.updateOne(
                { _id: new ObjectId(id) },
                { $set: updatedData }
            ));
        });

        
        app.delete('/contests/:id', async (req, res) => {
            const id = req.params.id;
            const userRole = req.query.role; 
            const query = { _id: new ObjectId(id) };

            const contest = await contestCollection.findOne(query);

            if (userRole !== 'admin') {
                if (contest?.status === 'Accepted' || contest?.status === 'Completed') {
                    return res.status(400).send({ message: "Only Admin can delete an accepted or completed contest." });
                }
            }

            const result = await contestCollection.deleteOne(query);
            res.send(result);
        });

        app.patch('/contests/status/:id', async (req, res) => {
            const filter = { _id: new ObjectId(req.params.id) };
            res.send(await contestCollection.updateOne(filter, { $set: { status: req.body.status } }));
        });

        // --- 4. Public & Popular APIs ---
app.get('/all-contests', async (req, res) => {
    try {
        const { search, category, sort, page, size } = req.query;
        const pageNumber = Math.max(0, parseInt(page) - 1) || 0;
        const limitNumber = parseInt(size) || 6;

        let query = { status: 'Accepted' };

        if (search?.trim()) {
            query.contestName = { $regex: search.trim(), $options: 'i' };
        }
        if (category && category !== 'All') {
            query.contestCategory = category;
        }
        let sortOption = { createdAt: -1 }; 
        if (sort === 'asc') sortOption = { contestPrice: 1 };
        if (sort === 'desc') sortOption = { contestPrice: -1 };

        const totalCount = await contestCollection.countDocuments(query);
        const result = await contestCollection
            .find(query)
            .sort(sortOption)
            .skip(pageNumber * limitNumber)
            .limit(limitNumber)
            .toArray();

        res.send({
            contests: result,
            totalPages: Math.ceil(totalCount / limitNumber),
            totalCount
        });
    } catch (error) {
        res.status(500).send({ message: "Error", error: error.message });
    }
});


// Statistics API
// Statistics API (Fixed Variable Names)
app.get('/get-stats', async (req, res) => {
    try {
        const totalParticipants = await participationCollection.countDocuments();
        const totalContests = await contestCollection.countDocuments({ status: 'Accepted' });
        const totalWinners = await contestCollection.countDocuments({ 
            winnerName: { $exists: true, $ne: null, $ne: "" } 
        });

        res.send({
            totalParticipants,
            totalContests,
            totalWinners
        });
    } catch (error) {
        console.error("Stats error:", error);
        res.status(500).send({ message: "Stats fetching failed", error: error.message });
    }
});


        app.get('/popular-contests', async (req, res) => {
            res.send(await contestCollection.find({ status: 'Accepted' })
                .sort({ participationCount: -1 }).limit(6).toArray());
        });

        // --- 5. Payment & Participation ---
        app.post('/create-checkout-session', async (req, res) => {
            try {
                const { cost, contestName, contestId, userEmail } = req.body;
                const amount = Math.round(parseFloat(cost) * 100);

                const session = await stripe.checkout.sessions.create({
                    payment_method_types: ['card'],
                    line_items: [{
                        price_data: {
                            currency: 'usd',
                            product_data: { name: contestName },
                            unit_amount: amount,
                        },
                        quantity: 1,
                    }],
                    mode: 'payment',
                    success_url: `${process.env.CLIENT_URL}/dashboard/my-participated?session_id={CHECKOUT_SESSION_ID}&contestId=${contestId}`,
                    cancel_url: `${process.env.CLIENT_URL}/payment/${contestId}`,
                    customer_email: userEmail,
                    metadata: { contestId, contestName, cost: cost.toString() }
                });
                res.send({ url: session.url });
            } catch (error) {
                res.status(500).send({ message: error.message });
            }
        });

        app.post('/verify-payment', async (req, res) => {
            const { sessionId, contestId } = req.body;
            const session = await stripe.checkout.sessions.retrieve(sessionId);

            if (session.payment_status === 'paid') {
                const exists = await participationCollection.findOne({ transactionId: session.payment_intent });
                if (exists) return res.send({ success: true });

                const contest = await contestCollection.findOne({ _id: new ObjectId(contestId) });
                const paymentInfo = {
                    contestId,
                    contestName: session.metadata.contestName,
                    transactionId: session.payment_intent,
                    price: session.metadata.cost,
                    userEmail: session.customer_details.email,
                    status: 'Paid',
                    deadline: contest?.contestDeadline,
                    paymentDate: new Date()
                };

                await participationCollection.insertOne(paymentInfo);
                await contestCollection.updateOne(
                    { _id: new ObjectId(contestId) },
                    { $inc: { participationCount: 1 } }
                );
                res.send({ success: true });
            } else {
                res.send({ success: false });
            }
        });

        app.get('/my-participations/:email', async (req, res) => {
            res.send(await participationCollection.find({ userEmail: req.params.email }).toArray());
        });

    // Task Submission API
app.patch('/submit-task/:id', async (req, res) => {
  try {
    const id = req.params.id;
    const { taskLink } = req.body;
    if (!ObjectId.isValid(id)) {
      return res.status(400).send({ success: false, message: "Invalid ID format" });
    }

    const result = await participationCollection.updateOne(
      { _id: new ObjectId(id) },
      { 
        $set: { 
          submittedTask: taskLink, 
          status: 'Submitted', 
          submittedAt: new Date() 
        } 
      }
    );

    if (result.matchedCount > 0) {
      res.send({ 
        success: true, 
        modifiedCount: result.modifiedCount,
        message: "Task updated successfully" 
      });
    } else {
      res.status(404).send({ success: false, message: "Participation record not found" });
    }
  } catch (error) {
    console.error("Task submission error:", error);
    res.status(500).send({ success: false, message: "Server error", error: error.message });
  }
});
     
// Submission Review API

    app.get('/submissions/:id', async (req, res) => {
        try {
            const contestId = req.params.id;
            const query = { 
                contestId: contestId,
                submittedTask: { $exists: true, $ne: null } 
            };
            
            const result = await participationCollection.find(query).toArray();
            res.send(result);
        } catch (error) {
            console.error("Fetch submissions error:", error);
            res.status(500).send({ message: "Error fetching submissions" });
        }
    });


        // --- 6. Winner & Leaderboard ---
        app.patch('/make-winner/:participationId', async (req, res) => {
            const { contestId, winnerEmail, winnerName } = req.body;
            const contest = await contestCollection.findOne({ _id: new ObjectId(contestId) });
            if (contest?.status === 'Completed') return res.status(400).send({ message: "Winner already declared!" });

            await contestCollection.updateOne(
                { _id: new ObjectId(contestId) },
                { $set: { winnerEmail, winnerName, status: 'Completed' } }
            );
            await usersCollection.updateOne({ email: winnerEmail }, { $inc: { winCount: 1 } });
            res.send({ success: true });
        });

        app.get('/leaderboard', async (req, res) => {
            const result = await usersCollection.find({ winCount: { $gt: 0 } })
                .sort({ winCount: -1 }).limit(10).toArray();
            res.send(result);
        });

        console.log("Database connected successfully!");
    } finally { }
}
run().catch(console.dir);

app.get('/', (req, res) => res.send('ContestHub Server is Running'));
app.listen(port, () => console.log(`Listening on port ${port}`));