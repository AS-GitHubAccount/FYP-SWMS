// Joi validate(body|query|params)
const Joi = require('joi');

function validate(schema, property = 'body') {
    return (req, res, next) => {
        const { error, value } = schema.validate(req[property], { abortEarly: false });
        if (error) {
            const msg = error.details.map(d => d.message).join('; ');
            return res.status(400).json({ success: false, error: msg });
        }
        req[property] = value;
        next();
    };
}

const loginSchema = Joi.object({
    email: Joi.string().email().required(),
    password: Joi.string().required(),
    role: Joi.string().valid('ADMIN', 'STAFF').required()
});

const bookingSchema = Joi.object({
    productId: Joi.number().integer().positive().required(),
    quantity: Joi.number().integer().positive().required(),
    requestedBy: Joi.number().integer().positive().required(),
    neededBy: Joi.date().allow(null),
    notes: Joi.string().allow('', null)
});

module.exports = { validate, loginSchema, bookingSchema };
