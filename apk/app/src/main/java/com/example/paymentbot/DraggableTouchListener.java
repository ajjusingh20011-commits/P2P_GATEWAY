package com.example.paymentbot;

import android.view.MotionEvent;
import android.view.View;
import android.view.WindowManager;

/**
 * Makes a floating overlay view draggable while still detecting taps. A short
 * touch that doesn't move (under the drag threshold and 300ms) fires onClick;
 * anything else drags the view via {@link WindowManager#updateViewLayout}.
 */
public class DraggableTouchListener implements View.OnTouchListener {

    private final WindowManager.LayoutParams params;
    private final WindowManager windowManager;
    private final View view;
    private final Runnable onClick;

    private int initialX, initialY;
    private float touchX, touchY;
    private long touchDownTime;
    private boolean isDragging = false;

    public DraggableTouchListener(WindowManager.LayoutParams params,
                                  WindowManager windowManager,
                                  View view,
                                  Runnable onClick) {
        this.params = params;
        this.windowManager = windowManager;
        this.view = view;
        this.onClick = onClick;
    }

    @Override
    public boolean onTouch(View v, MotionEvent e) {
        switch (e.getAction()) {
            case MotionEvent.ACTION_DOWN:
                initialX = params.x;
                initialY = params.y;
                touchX = e.getRawX();
                touchY = e.getRawY();
                touchDownTime = System.currentTimeMillis();
                isDragging = false;
                return true;

            case MotionEvent.ACTION_MOVE:
                float dx = e.getRawX() - touchX;
                float dy = e.getRawY() - touchY;
                if (Math.abs(dx) > 10 || Math.abs(dy) > 10) {
                    isDragging = true;
                }
                if (isDragging) {
                    params.x = initialX - (int) dx;
                    params.y = initialY + (int) dy;
                    try {
                        windowManager.updateViewLayout(view, params);
                    } catch (Exception ignored) {
                    }
                }
                return true;

            case MotionEvent.ACTION_UP:
                long duration = System.currentTimeMillis() - touchDownTime;
                if (!isDragging && duration < 300) {
                    if (onClick != null) onClick.run();
                }
                return true;
        }
        return false;
    }
}
