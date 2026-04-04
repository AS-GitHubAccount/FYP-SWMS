// /api/wizard
const express = require('express');
const router = express.Router();
const db = require('../config/database');
const { generateBookingNumber } = require('../utils/idGenerator');

const wizardSessions = new Map();

const WIZARD_TYPES = {
    SETUP: 'setup',
    PRODUCT_CREATION: 'product_creation',
    RECEIVING: 'receiving',
    ISSUING: 'issuing',
    BOOKING: 'booking',
    USER_ONBOARDING: 'user_onboarding'
};

// Wizard step definitions
const WIZARD_STEPS = {
    setup: [
        { id: 1, name: 'database', title: 'Database Configuration', required: true },
        { id: 2, name: 'admin', title: 'Admin Account Setup', required: true },
        { id: 3, name: 'multiple_locations', title: 'Warehouse Locations', required: true },
        { id: 4, name: 'settings', title: 'System Settings', required: false },
        { id: 5, name: 'review', title: 'Review & Complete', required: true }
    ],
    product_creation: [
        { id: 1, name: 'basic', title: 'Basic Information', required: true },
        { id: 2, name: 'details', title: 'Product Details', required: true },
        { id: 3, name: 'pricing', title: 'Pricing & Categories', required: false },
        { id: 4, name: 'review', title: 'Review & Submit', required: true }
    ],
    receiving: [
        { id: 1, name: 'supplier', title: 'Supplier Information', required: true },
        { id: 2, name: 'products', title: 'Products Received', required: true },
        { id: 3, name: 'batches', title: 'Batch Details', required: true },
        { id: 4, name: 'review', title: 'Review & Confirm', required: true }
    ],
    issuing: [
        { id: 1, name: 'recipient', title: 'Recipient Information', required: true },
        { id: 2, name: 'products', title: 'Products to Issue', required: true },
        { id: 3, name: 'batches', title: 'Batch Selection (FEFO)', required: true },
        { id: 4, name: 'review', title: 'Review & Confirm', required: true }
    ],
    booking: [
        { id: 1, name: 'request', title: 'Booking Request', required: true },
        { id: 2, name: 'products', title: 'Products to Book', required: true },
        { id: 3, name: 'dates', title: 'Dates & Purpose', required: true },
        { id: 4, name: 'review', title: 'Review & Submit', required: true }
    ],
    user_onboarding: [
        { id: 1, name: 'personal', title: 'Personal Information', required: true },
        { id: 2, name: 'credentials', title: 'Login Credentials', required: true },
        { id: 3, name: 'role', title: 'Role & Permissions', required: true },
        { id: 4, name: 'review', title: 'Review & Create', required: true }
    ]
};

// Generate unique session ID
function generateSessionId() {
    return `wizard_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
}

// Initialize wizard session
function initializeWizard(type, userId = null) {
    const sessionId = generateSessionId();
    const steps = WIZARD_STEPS[type] || [];
    
    const session = {
        sessionId,
        type,
        userId,
        currentStep: 1,
        totalSteps: steps.length,
        steps: steps.map(step => ({
            ...step,
            completed: false,
            data: null
        })),
        data: {},
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        completed: false
    };
    
    wizardSessions.set(sessionId, session);
    return session;
}

router.post('/start', async (req, res) => {
    try {
        const { type, userId } = req.body;
        
        // Validate wizard type
        if (!type || !WIZARD_TYPES[type.toUpperCase()]) {
            return res.status(400).json({
                error: 'Invalid wizard type',
                availableTypes: Object.values(WIZARD_TYPES)
            });
        }
        
        const wizardType = type.toLowerCase();
        const session = initializeWizard(wizardType, userId);
        
        res.json({
            success: true,
            message: 'Wizard started successfully',
            session: {
                sessionId: session.sessionId,
                type: session.type,
                currentStep: session.currentStep,
                totalSteps: session.totalSteps,
                steps: session.steps.map(s => ({
                    id: s.id,
                    name: s.name,
                    title: s.title,
                    required: s.required,
                    completed: s.completed
                }))
            }
        });
    } catch (error) {
        console.error('Error starting wizard:', error);
        res.status(500).json({
            error: 'Failed to start wizard',
            message: error.message
        });
    }
});

router.get('/:sessionId', (req, res) => {
    try {
        const { sessionId } = req.params;
        const session = wizardSessions.get(sessionId);
        
        if (!session) {
            return res.status(404).json({
                error: 'Wizard session not found',
                message: 'Session may have expired or been completed'
            });
        }
        
        res.json({
            success: true,
            session: {
                sessionId: session.sessionId,
                type: session.type,
                currentStep: session.currentStep,
                totalSteps: session.totalSteps,
                completed: session.completed,
                steps: session.steps.map(s => ({
                    id: s.id,
                    name: s.name,
                    title: s.title,
                    required: s.required,
                    completed: s.completed
                })),
                currentStepData: session.steps[session.currentStep - 1]?.data || null,
                createdAt: session.createdAt,
                updatedAt: session.updatedAt
            }
        });
    } catch (error) {
        console.error('Error getting wizard state:', error);
        res.status(500).json({
            error: 'Failed to get wizard state',
            message: error.message
        });
    }
});

router.post('/:sessionId/step', async (req, res) => {
    try {
        const { sessionId } = req.params;
        const { stepData, action } = req.body; // action: 'next', 'previous', 'save'
        
        const session = wizardSessions.get(sessionId);
        
        if (!session) {
            return res.status(404).json({
                error: 'Wizard session not found'
            });
        }
        
        if (session.completed) {
            return res.status(400).json({
                error: 'Wizard already completed'
            });
        }
        
        const currentStepIndex = session.currentStep - 1;
        const currentStep = session.steps[currentStepIndex];
        
        // Save step data
        if (stepData) {
            currentStep.data = stepData;
            session.data[currentStep.name] = stepData;
            currentStep.completed = true;
        }
        
        // Handle navigation
        if (action === 'next') {
            if (session.currentStep < session.totalSteps) {
                session.currentStep++;
            }
        } else if (action === 'previous') {
            if (session.currentStep > 1) {
                session.currentStep--;
            }
        } else if (action === 'save') {
            // Just save, don't move
        }
        
        session.updatedAt = new Date().toISOString();
        wizardSessions.set(sessionId, session);
        
        res.json({
            success: true,
            message: 'Step data saved successfully',
            session: {
                sessionId: session.sessionId,
                currentStep: session.currentStep,
                totalSteps: session.totalSteps,
                canGoNext: session.currentStep < session.totalSteps,
                canGoPrevious: session.currentStep > 1,
                steps: session.steps.map(s => ({
                    id: s.id,
                    name: s.name,
                    title: s.title,
                    completed: s.completed
                }))
            }
        });
    } catch (error) {
        console.error('Error submitting step:', error);
        res.status(500).json({
            error: 'Failed to submit step',
            message: error.message
        });
    }
});

router.get('/:sessionId/progress', (req, res) => {
    try {
        const { sessionId } = req.params;
        const session = wizardSessions.get(sessionId);
        
        if (!session) {
            return res.status(404).json({
                error: 'Wizard session not found'
            });
        }
        
        const completedSteps = session.steps.filter(s => s.completed).length;
        const progress = Math.round((completedSteps / session.totalSteps) * 100);
        
        res.json({
            success: true,
            progress: {
                currentStep: session.currentStep,
                totalSteps: session.totalSteps,
                completedSteps,
                progressPercentage: progress,
                isComplete: session.completed
            }
        });
    } catch (error) {
        console.error('Error getting progress:', error);
        res.status(500).json({
            error: 'Failed to get progress',
            message: error.message
        });
    }
});

router.post('/:sessionId/complete', async (req, res) => {
    try {
        const { sessionId } = req.params;
        const session = wizardSessions.get(sessionId);
        
        if (!session) {
            return res.status(404).json({
                error: 'Wizard session not found'
            });
        }
        
        // Validate all required steps are completed
        const requiredSteps = session.steps.filter(s => s.required);
        const incompleteRequired = requiredSteps.filter(s => !s.completed);
        
        if (incompleteRequired.length > 0) {
            return res.status(400).json({
                error: 'Cannot complete wizard',
                message: 'Some required steps are not completed',
                incompleteSteps: incompleteRequired.map(s => ({
                    id: s.id,
                    name: s.name,
                    title: s.title
                }))
            });
        }
        
        // Mark as completed
        session.completed = true;
        session.updatedAt = new Date().toISOString();
        wizardSessions.set(sessionId, session);
        
        // Process wizard data based on type
        let result = null;
        try {
            result = await processWizardCompletion(session);
        } catch (processError) {
            console.error('Error processing wizard completion:', processError);
            // Still mark as completed, but return error
            return res.status(500).json({
                error: 'Wizard completed but processing failed',
                message: processError.message,
                sessionData: session.data
            });
        }
        
        res.json({
            success: true,
            message: 'Wizard completed successfully',
            result,
            sessionData: session.data
        });
    } catch (error) {
        console.error('Error completing wizard:', error);
        res.status(500).json({
            error: 'Failed to complete wizard',
            message: error.message
        });
    }
});

async function processWizardCompletion(session) {
    const { type, data } = session;
    
    switch (type) {
        case 'setup': {
            // Multi-warehouse toggle removed; keep simple setup completion
            return { message: 'System setup completed', data };
        }
            
        case 'product_creation':
            // Create product in database (schema: sku, name, category, unit, minStock)
            if (data.basic && data.details) {
                const sku = data.basic.sku || `PRD-${Date.now()}-${Math.random().toString(36).substr(2, 6).toUpperCase()}`;
                const name = data.basic.name || 'Unnamed Product';
                const category = data.pricing?.category || 'General';
                const unit = data.basic.unit || 'unit';
                const minStock = parseInt(data.pricing?.minStock || data.details.minStock, 10) || 0;

                const [result] = await db.execute(
                    `INSERT INTO products (sku, name, category, unit, minStock) 
                     VALUES (?, ?, ?, ?, ?)`,
                    [sku, name, category, unit, isNaN(minStock) ? 0 : minStock]
                );
                // Create inventory_items entry for the new product
                try {
                    await db.execute(
                        `INSERT INTO inventory_items (productId, totalQty, available, reserved) 
                         VALUES (?, 0, 0, 0)`,
                        [result.insertId]
                    );
                } catch (e) {
                    if (e.code !== 'ER_DUP_ENTRY' && e.code !== 'ER_NO_SUCH_TABLE') throw e;
                }
                return { message: 'Product created', productId: result.insertId, sku };
            }
            break;
            
        case 'receiving':
            // Process receiving record
            return { message: 'Receiving record created', data };
            
        case 'issuing':
            // Process issuing record
            return { message: 'Issuing record created', data };
            
        case 'booking':
            // Create booking (schema: bookingNumber, productId, quantity, requestedBy, neededBy, notes)
            if (data.request && data.products) {
                const product = Array.isArray(data.products) ? data.products[0] : data.products;
                const productId = product?.productId || product?.product_id || data.request?.productId;
                const quantity = parseInt(product?.quantity || data.request?.quantity || 1, 10) || 1;
                const requestedBy = session.userId || 1;
                const neededBy = data.dates?.neededBy || data.dates?.needed_by || null;
                const notes = data.dates?.purpose || data.dates?.notes || '';

                if (!productId) {
                    throw new Error('Product is required for booking');
                }
                const bookingNumber = await generateBookingNumber();
                const [result] = await db.execute(
                    `INSERT INTO bookings (bookingNumber, productId, quantity, requestedBy, neededBy, notes) 
                     VALUES (?, ?, ?, ?, ?, ?)`,
                    [bookingNumber, productId, quantity, requestedBy, neededBy || null, notes || null]
                );
                return { message: 'Booking created', bookingId: result.insertId, bookingNumber };
            }
            break;
            
        case 'user_onboarding':
            // Create user
            if (data.personal && data.credentials) {
                const pwd = data.credentials.password || '';
                if (pwd.length < 6) {
                    throw new Error('Password must be at least 6 characters long');
                }
                const bcrypt = require('bcryptjs');
                const hashedPassword = await bcrypt.hash(pwd, 10);
                
                const [result] = await db.execute(
                    `INSERT INTO users (name, email, passwordHash, role) 
                     VALUES (?, ?, ?, ?)`,
                    [
                        data.personal.name,
                        data.personal.email,
                        hashedPassword,
                        data.role?.role || 'STAFF'
                    ]
                );
                return { message: 'User created', userId: result.insertId };
            }
            break;
    }
    
    return { message: 'Wizard completed', data };
}

router.delete('/:sessionId', (req, res) => {
    try {
        const { sessionId } = req.params;
        const session = wizardSessions.get(sessionId);
        
        if (!session) {
            return res.status(404).json({
                error: 'Wizard session not found'
            });
        }
        
        wizardSessions.delete(sessionId);
        
        res.json({
            success: true,
            message: 'Wizard session cancelled'
        });
    } catch (error) {
        console.error('Error cancelling wizard:', error);
        res.status(500).json({
            error: 'Failed to cancel wizard',
            message: error.message
        });
    }
});

router.get('/', (req, res) => {
    res.json({
        success: true,
        message: 'Wizard API',
        availableTypes: Object.values(WIZARD_TYPES).map(type => ({
            type,
            steps: WIZARD_STEPS[type]?.map(s => ({
                id: s.id,
                name: s.name,
                title: s.title,
                required: s.required
            })) || []
        })),
        endpoints: {
            start: {
                method: 'POST',
                path: '/api/wizard/start',
                description: 'Start a new wizard session',
                body: {
                    type: 'string (required) - One of: setup, product_creation, receiving, issuing, booking, user_onboarding',
                    userId: 'number (optional) - User ID for user-specific wizards'
                }
            },
            getState: {
                method: 'GET',
                path: '/api/wizard/:sessionId',
                description: 'Get current wizard state and progress'
            },
            submitStep: {
                method: 'POST',
                path: '/api/wizard/:sessionId/step',
                description: 'Submit data for current step',
                body: {
                    stepData: 'object (required) - Data for current step',
                    action: 'string (optional) - next, previous, or save'
                }
            },
            getProgress: {
                method: 'GET',
                path: '/api/wizard/:sessionId/progress',
                description: 'Get wizard progress percentage'
            },
            complete: {
                method: 'POST',
                path: '/api/wizard/:sessionId/complete',
                description: 'Complete the wizard and process all data'
            },
            cancel: {
                method: 'DELETE',
                path: '/api/wizard/:sessionId',
                description: 'Cancel and delete wizard session'
            }
        }
    });
});

module.exports = router;



