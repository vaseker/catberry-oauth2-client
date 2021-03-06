/*
 * catberry-oauth
 *
 * Copyright (c) 2014 Denis Rechkunov and project contributors.
 *
 * catberry-oauth's license follows:
 *
 * Permission is hereby granted, free of charge, to any person
 * obtaining a copy of this software and associated documentation
 * files (the "Software"), to deal in the Software without restriction,
 * including without limitation the rights to use, copy, modify, merge,
 * publish, distribute, sublicense, and/or sell copies of the Software,
 * and to permit persons to whom the Software is furnished to do so,
 * subject to the following conditions:
 *
 * The above copyright notice and this permission notice shall be included
 * in all copies or substantial portions of the Software.
 *
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS
 * OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
 * THE SOFTWARE.
 *
 * This license applies to all parts of catberry-oauth that are not externally
 * maintained libraries.
 */

'use strict';

module.exports = GrantFlowMiddlewareBase;

var httpHelper = require('../helpers/httpHelper');

var FIELD_ACCESS_TOKEN = 'access_token',
	FIELD_REFRESH_TOKEN = 'refresh_token',
	FIELD_TOKEN_TYPE = 'token_type',
	TRACE_AUTH_RECEIVED = 'Authorization issued from server',
	DEFAULT_ACCESS_TOKEN_EXPIRATION = 3600,
	DEFAULT_REFRESH_TOKEN_EXPIRATION = 3110400000, // about 100 years
	ERROR_ENDPOINT_NAME = 'Endpoint name must be specified',
	ERROR_RESPONSE_ACCESS_TOKEN = 'Response from authorization server ' +
		'does not have required "access_token" field',
	ERROR_RESPONSE_TOKEN_TYPE = 'Response from authorization server ' +
		'does not have required "token_type" field',
	ERROR_RESPONSE_TOKEN_TYPE_NOT_SUPPORTED = 'Only Bearer token type ' +
		'is supported',
	ERROR_COOKIE_CONFIG = 'At least two parameters: ' +
		'"cookie.accessTokenName" and "cookie.refreshTokenName" must be set',
	ERROR_CONFIG = 'Config must be an object';

/**
 * Creates new instance of grant flow middleware.
 * @param {ServiceLocator} $serviceLocator Service locator
 * to resolve dependencies.
 *
 * @param {Object} endpointConfig Endpoint configuration.
 * @param {String?} endpointConfig.scope Access scope for middleware.
 * @param {Object} endpointConfig.cookie Token cookie configuration.
 * @param {String} endpointConfig.cookie.accessTokenName Name of cookie
 * with access token.
 * @param {String?} endpointConfig.cookie.accessTokenExpiresIn Expiration time
 * in seconds for access token cookie if it is not specified by authorization
 * server (3 600 secs by default, 1 hour).
 * @param {String} endpointConfig.cookie.refreshTokenName Name of cookie
 * with refresh token.
 * @param {String?} endpointConfig.cookie.refreshTokenExpiresIn Expiration time
 * in seconds for refresh token cookie
 * (3 110 400 000 secs by default, 100 years).
 * @param {String?} endpointConfig.cookie.path Path attribute for cookie
 * ('/' by default).
 * @param {String?} endpointConfig.cookie.domain Domain attribute for cookie.
 * @constructor
 */
function GrantFlowMiddlewareBase($serviceLocator, endpointConfig) {
	validateConfig(endpointConfig);
	this._logger = $serviceLocator.resolve('logger');
	this._endpointName = endpointConfig.name;
	this._cookieConfig = Object.create(endpointConfig.cookie);
	if (typeof(this._cookieConfig.path) !== 'string' ||
		this._cookieConfig.path.length === 0) {
		this._cookieConfig.path = '/';
	}
	if (typeof(this._cookieConfig.domain) !== 'string' ||
		this._cookieConfig.domain.length === 0) {
		this._cookieConfig.domain = '';
	}
	if (typeof(this._cookieConfig.accessTokenExpiresIn) !== 'number' ||
		this._cookieConfig.accessTokenExpiresIn < 0) {
		this._cookieConfig.accessTokenExpiresIn =
			DEFAULT_ACCESS_TOKEN_EXPIRATION;
	}
	if (typeof(this._cookieConfig.refreshTokenExpiresIn) !== 'number' ||
		this._cookieConfig.refreshTokenExpiresIn < 0) {
		this._cookieConfig.refreshTokenExpiresIn =
			DEFAULT_REFRESH_TOKEN_EXPIRATION;
	}
	this._scope = typeof(endpointConfig.scope) === 'string' ?
		endpointConfig.scope :
		this._scope;
}

/**
 * Current logger.
 * @type {Logger}
 * @protected
 */
GrantFlowMiddlewareBase.prototype._logger = null;

/**
 * Current cookie configuration.
 * @type {Object}
 * @protected
 */
GrantFlowMiddlewareBase.prototype._cookieConfig = null;

/**
 * Current OAuth 2.0 scope of the access request.
 * http://tools.ietf.org/html/rfc6749#section-3.3.
 * @type {string}
 * @protected
 */
GrantFlowMiddlewareBase.prototype._scope = '';

/**
 * Current name of endpoint.
 * @type {string}
 * @protected
 */
GrantFlowMiddlewareBase.prototype._endpointName = '';

/**
 * Handles middleware invocation.
 * @param {http.IncomingMessage} request HTTP request.
 * @param {http.ServerResponse} response HTTP response.
 * @param {Function} next Middleware next function.
 * @abstract
 */
GrantFlowMiddlewareBase.prototype.handler = function (request, response, next) {
	next();
};

/**
 * Sets access token and refresh token to cookie in request and response.
 * @param {http.IncomingMessage} request HTTP request.
 * @param {http.ServerResponse} response HTTP response.
 * @param {Object} issuedAuth Issued authorization object.
 * @param {String} issuedAuth.access_token Access token.
 * @param {String} issuedAuth.token_type Access token type.
 * @param {Number?} issuedAuth.expires_in Time in seconds from now
 * when access token expires.
 * @param {String?} issuedAuth.refresh_token Refresh token.
 * @param {String?} issuedAuth.scope Access token scope.
 * @protected
 */
GrantFlowMiddlewareBase.prototype._handleIssuedAuthorization =
	function (request, response, issuedAuth) {
		validateIssuedAuth(issuedAuth);
		this._logger.trace(TRACE_AUTH_RECEIVED);
		var accessTokenSetup = this._getCookieSetup(
				this._cookieConfig.accessTokenName,
				issuedAuth[FIELD_ACCESS_TOKEN],
				this._cookieConfig.accessTokenExpiresIn
			);

		httpHelper.setCookie(request, response, accessTokenSetup);

		if (typeof(issuedAuth[FIELD_REFRESH_TOKEN]) === 'string') {
			var refreshTokenSetup = this._getCookieSetup(
				this._cookieConfig.refreshTokenName,
				issuedAuth[FIELD_REFRESH_TOKEN],
				this._cookieConfig.refreshTokenExpiresIn
			);
			refreshTokenSetup.httpOnly = true;
			httpHelper.setCookie(request, response, refreshTokenSetup);
		}

		return issuedAuth;
	};

/**
 * Gets cookie setup object.
 * @param {String} name Cookie name.
 * @param {String?} value Cookie value.
 * @param {Number} expiresIn Expiration of cookie in seconds.
 * @returns {Object} Cookie setup object.
 * @private
 */
GrantFlowMiddlewareBase.prototype._getCookieSetup =
	function (name, value, expiresIn) {
		value = String(value);
		var setup = {
			key: name,
			value: value
		};

		if (typeof(this._cookieConfig.domain) === 'string' ||
			this._cookieConfig.domain.length !== 0) {
			setup.domain = this._cookieConfig.domain;
		}
		if (typeof(this._cookieConfig.path) === 'string' ||
			this._cookieConfig.path.length !== 0) {
			setup.path = this._cookieConfig.path;
		}
		if (typeof(this._cookieConfig.secure) === 'boolean') {
			setup.secure = this._cookieConfig.secure;
		}

		if (typeof(setup.maxAge) !== 'number') {
			setup.maxAge = expiresIn;
		}

		return setup;
	};

/**
 * Validates middleware configuration.
 * @param {Object} config Configuration object.
 */
/*jshint maxcomplexity:false */
function validateConfig(config) {
	if (!config || typeof(config) !== 'object') {
		throw new Error(ERROR_CONFIG);
	}
	if (typeof(config.name) !== 'string' || config.name.length === 0) {
		throw new Error(ERROR_ENDPOINT_NAME);
	}
	if (!config.cookie || typeof(config.cookie) !== 'object' ||
		typeof(config.cookie.accessTokenName) !== 'string' ||
		config.cookie.accessTokenName.length === 0 ||
		typeof(config.cookie.refreshTokenName) !== 'string' ||
		config.cookie.refreshTokenName.length === 0) {
		throw new Error(ERROR_COOKIE_CONFIG);
	}
}

/**
 * Validates issued authorization from authorization server.
 * @param {Object} issuedAuth Issues authorization object.
 */
function validateIssuedAuth(issuedAuth) {
	// http://tools.ietf.org/html/rfc6749#section-5.1
	if (typeof(issuedAuth[FIELD_ACCESS_TOKEN]) !== 'string') {
		var tokenError = new Error(ERROR_RESPONSE_ACCESS_TOKEN);
		tokenError.code = 500;
		throw tokenError;
	}
	if (typeof(issuedAuth[FIELD_TOKEN_TYPE]) !== 'string') {
		var tokenTypeError = new Error(ERROR_RESPONSE_TOKEN_TYPE);
		tokenTypeError.code = 500;
		throw tokenTypeError;
	}
	if (issuedAuth[FIELD_TOKEN_TYPE].toLowerCase() !== 'bearer') {
		var wrongTokenTypeError = new Error(
			ERROR_RESPONSE_TOKEN_TYPE_NOT_SUPPORTED
		);
		wrongTokenTypeError.code = 500;
		throw wrongTokenTypeError;
	}
}