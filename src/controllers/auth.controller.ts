// src/controllers/auth.controller.ts
import { Request, Response, RequestHandler } from 'express';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import { prisma } from '../index';

// Define interfaces for type safety
interface RegisterBody {
  email: string;
  password: string;
  firstName: string;
  lastName: string;
  companyName: string;
}

interface LoginBody {
  email: string;
  password: string;
}

interface JwtPayload {
  userId: string;
  companyId: string;
  role: string;
}

// Type the handlers properly using RequestHandler with generics
export const register: RequestHandler<{}, any, RegisterBody> = async (req, res): Promise<void> => {
  try {
    const { email, password, firstName, lastName, companyName } = req.body;
    
    // Validate required fields
    if (!email || !password || !firstName || !lastName || !companyName) {
      res.status(400).json({ error: 'All fields are required' });
      return;
    }
    
    // Check if user exists
    const existingUser = await prisma.user.findUnique({
      where: { email }
    });
    
    if (existingUser) {
      res.status(400).json({ error: 'User already exists' });
      return;
    }
    
    // Hash password
    const hashedPassword = await bcrypt.hash(password, 10);
    
    // Create company and user
    const company = await prisma.company.create({
      data: {
        name: companyName,
        email,
        users: {
          create: {
            email,
            password: hashedPassword,
            firstName,
            lastName,
            role: 'ADMIN'
          }
        }
      },
      include: {
        users: true
      }
    });
    
    const user = company.users[0];
    
    // Ensure JWT_SECRET exists
    const jwtSecret = process.env.JWT_SECRET;
    if (!jwtSecret) {
      throw new Error('JWT_SECRET environment variable is not set');
    }
    
    // Generate token with proper payload
    const payload: JwtPayload = {
      userId: user.id,
      companyId: company.id,
      role: user.role
    };
    
    const token = jwt.sign(
      payload,
      jwtSecret,
      { 
        expiresIn: process.env.JWT_EXPIRE || '7d',
        algorithm: 'HS256'
      } as jwt.SignOptions
    );
    
    res.status(201).json({
      token,
      user: {
        id: user.id,
        email: user.email,
        firstName: user.firstName,
        lastName: user.lastName,
        role: user.role
      },
      company: {
        id: company.id,
        name: company.name
      }
    });
  } catch (error) {
    console.error('Register error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

export const login: RequestHandler<{}, any, LoginBody> = async (req, res): Promise<void> => {
  try {
    const { email, password } = req.body;
    
    // Validate required fields
    if (!email || !password) {
      res.status(400).json({ error: 'Email and password are required' });
      return;
    }
    
    // Find user
    const user = await prisma.user.findUnique({
      where: { email },
      include: { company: true }
    });
    
    if (!user || !user.isActive) {
      res.status(401).json({ error: 'Invalid credentials' });
      return;
    }
    
    // Check password
    const isPasswordValid = await bcrypt.compare(password, user.password);
    
    if (!isPasswordValid) {
      res.status(401).json({ error: 'Invalid credentials' });
      return;
    }
    
    // Update last login
    await prisma.user.update({
      where: { id: user.id },
      data: { lastLogin: new Date() }
    });
    
    // Ensure JWT_SECRET exists
    const jwtSecret = process.env.JWT_SECRET;
    if (!jwtSecret) {
      throw new Error('JWT_SECRET environment variable is not set');
    }
    
    // Generate token with proper payload
    const payload: JwtPayload = {
      userId: user.id,
      companyId: user.companyId,
      role: user.role
    };
    
    const token = jwt.sign(
      payload,
      jwtSecret,
      { 
        expiresIn: process.env.JWT_EXPIRE || '7d',
        algorithm: 'HS256'
      } as jwt.SignOptions
    );
    
    res.json({
      token,
      user: {
        id: user.id,
        email: user.email,
        firstName: user.firstName,
        lastName: user.lastName,
        role: user.role
      },
      company: {
        id: user.company.id,
        name: user.company.name
      }
    });
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

export const refreshToken: RequestHandler = async (req, res): Promise<void> => {
  try {
    const authHeader = req.headers.authorization;
    const token = authHeader && authHeader.split(' ')[1];
    
    if (!token) {
      res.status(401).json({ error: 'No token provided' });
      return;
    }
    
    const jwtSecret = process.env.JWT_SECRET;
    if (!jwtSecret) {
      throw new Error('JWT_SECRET environment variable is not set');
    }
    
    // Verify current token
    const decoded = jwt.verify(token, jwtSecret) as JwtPayload;
    
    // Find user to ensure they still exist and are active
    const user = await prisma.user.findUnique({
      where: { id: decoded.userId },
      include: { company: true }
    });
    
    if (!user || !user.isActive) {
      res.status(401).json({ error: 'User not found or inactive' });
      return;
    }
    
    // Generate new token
    const payload: JwtPayload = {
      userId: user.id,
      companyId: user.companyId,
      role: user.role
    };
    
    const newToken = jwt.sign(
      payload,
      jwtSecret,
      { 
        expiresIn: process.env.JWT_EXPIRE || '7d',
        algorithm: 'HS256'
      } as jwt.SignOptions
    );
    
    res.json({
      token: newToken,
      user: {
        id: user.id,
        email: user.email,
        firstName: user.firstName,
        lastName: user.lastName,
        role: user.role
      },
      company: {
        id: user.company.id,
        name: user.company.name
      }
    });
  } catch (error) {
    if (error instanceof jwt.JsonWebTokenError) {
      res.status(401).json({ error: 'Invalid token' });
      return;
    }
    console.error('Refresh token error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};